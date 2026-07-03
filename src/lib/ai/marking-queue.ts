import { query, withDbClient } from "@/lib/db";
import {
  ShortTextActivityBodySchema,
  ShortTextSubmissionBodySchema,
  UploadSpreadsheetActivityBodySchema,
  UploadSpreadsheetSubmissionBodySchema,
  UploadWorksheetActivityBodySchema,
  UploadWorksheetSubmissionBodySchema,
} from "@/types";
import { invokeAiMarking } from "./ai-marking-client";
import { parseSpreadsheet } from "@/lib/spreadsheet/parse-xlsx";
import { createLocalStorageClient } from "@/lib/storage/local-storage";
import { emitSubmissionEvent } from "@/lib/sse/topics";

// The marking AI agent expects question/model_answer/marking_guidance/pupil_answer
// on every request. Fall back to "Not Set" so no field is ever empty/undefined.
function markingFieldOrNotSet(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : "Not Set";
}

async function resolveUploadWorksheetMarkingGuidance(
  markingGuidance: string,
  markingGuidanceId: string | undefined,
): Promise<string> {
  if (!markingGuidanceId) {
    return markingGuidance;
  }

  const { rows } = await query<{ content: string }>(
    `SELECT content FROM marking_guidances WHERE id = $1`,
    [markingGuidanceId],
  );

  const guidanceContent = rows[0]?.content;
  if (!guidanceContent) {
    return markingGuidance;
  }

  return [guidanceContent, markingGuidance].filter((part) => part.trim().length > 0).join("\n\n");
}

export async function logQueueEvent(
  level: "info" | "warn" | "error",
  message: string,
  metadata: any = {},
) {
  await query(
    `INSERT INTO ai_marking_logs (level, message, metadata) VALUES ($1, $2, $3)`,
    [level, message, JSON.stringify(metadata)],
  );
}

export async function enqueueMarkingTasks(
  assignmentId: string,
  tasks: Array<{ submissionId: string }>,
  options?: { processAfterSeconds?: number },
) {
  if (tasks.length === 0) return;

  const delaySecs = options?.processAfterSeconds ?? 0;

  await logQueueEvent(
    "info",
    `Enqueueing ${tasks.length} tasks for assignment ${assignmentId}` +
      (delaySecs > 0 ? ` (debounced ${delaySecs}s)` : ""),
  );

  for (const task of tasks) {
    await query(
      `update submissions set mark_status='waiting', mark_error=null where submission_id=$1`,
      [task.submissionId],
    );
    await query(
      `
        insert into ai_marking_queue (submission_id, assignment_id, attempts, process_after)
        values ($1, $2, 0, now() + make_interval(secs => $3))
        on conflict (submission_id) do update set
          assignment_id = excluded.assignment_id,
          attempts = 0,
          process_after = now() + make_interval(secs => $3),
          updated_at = now()
      `,
      [task.submissionId, assignmentId, delaySecs],
    );
  }
}

export async function processNextQueueItem() {
  const secret = process.env.MARKING_QUEUE_SECRET;
  const callbackUrl = process.env.AI_MARKING_CALLBACK_URL;
  const BATCH_SIZE = 5;

  // 1. Claim a batch of submissions by their mark_status
  // We use the global query pool directly so we don't lock a single client for the duration
  const { rows } = await query<{
    submission_id: string;
    assignment_id: string;
    attempts: number;
  }>(
    `
    update submissions s
    set mark_status = 'marking'
    from (
      select q.submission_id, q.assignment_id, q.attempts
      from ai_marking_queue q
      join submissions sub on sub.submission_id = q.submission_id
      where sub.mark_status = 'waiting' and q.process_after <= now() and q.attempts < 3
      order by q.process_after asc
      limit $1
      for update of q skip locked
    ) picked
    where s.submission_id = picked.submission_id
    returning s.submission_id, picked.assignment_id as assignment_id, picked.attempts as attempts
    `,
    [BATCH_SIZE],
  );

  // 1b. Claim a batch of revision answers by their own status lifecycle
  const { rows: revClaimed } = await query<{
    submission_id: string;
    assignment_id: string;
    attempts: number;
  }>(
    `update revision_answers ra set status='marking'
     from (
       select q.submission_id, q.assignment_id, q.attempts
       from ai_marking_queue q
       join revision_answers r on r.answer_id = q.submission_id::uuid
       where q.assignment_id = 'revision' and r.status = 'pending_marking'
         and q.process_after <= now() and q.attempts < 3
       order by q.process_after asc
       limit $1
       for update of q skip locked
     ) picked
     where ra.answer_id = picked.submission_id::uuid
     returning ra.answer_id as submission_id, picked.assignment_id as assignment_id, picked.attempts as attempts`,
    [BATCH_SIZE],
  );

  const claimed = [...(rows as any[]), ...(revClaimed as any[])];

  if (claimed.length === 0) {
    return { processed: 0, remaining: 0 };
  }

  await logQueueEvent(
    "info",
    `Claimed batch of ${claimed.length} items for processing`,
  );

  // 2. Process in parallel
  const results = await Promise.allSettled(
    claimed.map((item) => processSingleItem(item, callbackUrl)),
  );

  // 3. Check remaining
  const { rows: countRows } = await query(
    `select
       (select count(*) from ai_marking_queue q join submissions s on s.submission_id=q.submission_id where s.mark_status='waiting' and q.process_after<=now() and q.attempts<3)
     + (select count(*) from ai_marking_queue q join revision_answers r on r.answer_id=q.submission_id::uuid where q.assignment_id='revision' and r.status='pending_marking' and q.process_after<=now() and q.attempts<3)
       as count`,
  );
  const remainingCount = parseInt((countRows[0] as any).count, 10);

  if (remainingCount === 0) {
    await logQueueEvent(
      "info",
      "Queue processing complete (no remaining pending items)",
    );
  }

  // Count successfully processed items (fulfilled promises)
  const processedCount = results.filter((r) => r.status === "fulfilled").length;

  return { processed: processedCount, remaining: remainingCount };
}

async function processSingleItem(
  item: {
    submission_id: string;
    assignment_id: string;
    attempts: number;
  },
  callbackUrl?: string,
) {
  try {
    await logQueueEvent(
      "info",
      `Processing submission ${item.submission_id} (Attempt ${item.attempts})`,
    );

    // 2. Fetch context for DO function
    // Use global query for parallel safety
    const { rows: contextRows } = await query(
      `
        SELECT
          s.body as submission_body,
          s.user_id as pupil_id,
          a.body_data as activity_body,
          a.activity_id,
          a.type,
          a.max_marks
        FROM submissions s
        JOIN activities a ON a.activity_id = s.activity_id
        WHERE s.submission_id = $1
        LIMIT 1
        `,
      [item.submission_id],
    );

    let context = contextRows[0];

    // Fallback: Check revision_answers if not found in submissions
    if (!context) {
      const { rows: revisionRows } = await query(
        `
          SELECT
            ra.answer_data as submission_body,
            r.pupil_id as pupil_id,
            a.body_data as activity_body,
            a.activity_id,
            a.type,
            a.max_marks
          FROM revision_answers ra
          JOIN revisions r ON r.revision_id = ra.revision_id
          JOIN activities a ON a.activity_id = ra.activity_id
          WHERE ra.answer_id = $1
          LIMIT 1
          `,
        [item.submission_id], // We queue answer_id as submission_id
      );
      context = revisionRows[0];
    }
    if (!context) {
      throw new Error("Submission or activity context missing");
    }

    const SUPPORTED_TYPES = new Set(["short-text-question", "upload-spreadsheet", "upload-worksheet"]);
    if (!SUPPORTED_TYPES.has(context.type as string)) {
      await logQueueEvent(
        "warn",
        `Skipping unsupported activity type ${context.activity_id}`,
        { type: context.type },
      );

      // Unsupported: mark the submission as errored and drop the queue row so we don't retry
      await query(
        `update submissions set mark_status='marking-error', mark_error='Unsupported activity type' where submission_id=$1`,
        [item.submission_id],
      );
      await query(
        `delete from ai_marking_queue where submission_id=$1`,
        [item.submission_id],
      );
      void emitSubmissionEvent("submission.updated", {
        submissionId: item.submission_id,
        activityId: context.activity_id as string,
        pupilId: context.pupil_id as string,
        markStatus: "marking-error",
        markError: "Unsupported activity type",
      });
      return;
    }

    // Emit marking SSE now that we know this item will be sent to the AI
    void emitSubmissionEvent("submission.updated", {
      submissionId: item.submission_id,
      activityId: context.activity_id as string,
      pupilId: context.pupil_id as string,
      markStatus: "marking",
    });

    // 3. Trigger DO function
    let effectiveCallbackUrl: string | undefined;

    if (callbackUrl) {
      const normalizedBase = callbackUrl.replace(/\/$/, "");

      if (item.assignment_id === "revision") {
        effectiveCallbackUrl = `${normalizedBase}/webhooks/ai-mark-revision`;
      } else {
        effectiveCallbackUrl = `${normalizedBase}/webhooks/ai-mark`;
      }
    }

    if (context.type === "short-text-question") {
      const parsedActivity = ShortTextActivityBodySchema.parse(
        context.activity_body,
      );
      const parsedSubmission = ShortTextSubmissionBodySchema.parse(
        context.submission_body,
      );

      const doParams = {
        question: parsedActivity.question,
        model_answer: markingFieldOrNotSet(parsedActivity.modelAnswer),
        marking_guidance: markingFieldOrNotSet(
          (parsedActivity as { markingGuidance?: unknown }).markingGuidance,
        ),
        pupil_answer: parsedSubmission.answer || "",
        max_marks: typeof context.max_marks === "number" ? context.max_marks : 1,
        webhook_url: effectiveCallbackUrl,
        group_assignment_id: item.assignment_id,
        activity_id: context.activity_id as string,
        pupil_id: context.pupil_id as string,
        submission_id: item.submission_id,
      };

      await logQueueEvent(
        "info",
        `Triggering n8n workflow for submission ${item.submission_id}`,
        doParams,
      );

      await invokeAiMarking(doParams);
    } else if (context.type === "upload-spreadsheet") {
      const parsedActivity = UploadSpreadsheetActivityBodySchema.parse(
        context.activity_body,
      );
      const parsedSubmission = UploadSpreadsheetSubmissionBodySchema.parse(
        context.submission_body,
      );

      const storage = createLocalStorageClient("lessons");
      const { stream, error: streamError } = await storage.getFileStream(
        parsedSubmission.filePath,
      );
      if (streamError || !stream) {
        throw new Error(
          `Failed to read spreadsheet file at ${parsedSubmission.filePath}: ${streamError?.message ?? "no stream"}`,
        );
      }

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      const spreadsheetData = await parseSpreadsheet(buffer);
      const spreadsheetBase64 = buffer.toString("base64");

      const doParams = {
        task: parsedActivity.task,
        marking_guidance: parsedActivity.markingGuidance,
        spreadsheet_base64: spreadsheetBase64,
        spreadsheet_data: spreadsheetData,
        webhook_url: effectiveCallbackUrl,
        group_assignment_id: item.assignment_id,
        activity_id: context.activity_id as string,
        pupil_id: context.pupil_id as string,
        submission_id: item.submission_id,
      };

      await logQueueEvent(
        "info",
        `Triggering n8n workflow for spreadsheet submission ${item.submission_id}`,
      );

      await invokeAiMarking(doParams);
    } else {
      const parsedActivity = UploadWorksheetActivityBodySchema.parse(
        context.activity_body,
      );
      const parsedSubmissionBody = UploadWorksheetSubmissionBodySchema.parse(
        context.submission_body ?? {},
      );

      const resolvedMarkingGuidance = await resolveUploadWorksheetMarkingGuidance(
        parsedActivity.markingGuidance,
        parsedActivity.markingGuidanceId,
      );

      const doParams = {
        // Upload Exam Question uses the same marking contract as short-text:
        // question <- task, no model answer, guidance <- resolved guidance,
        // pupil_answer <- the OCR'd text.
        question: parsedActivity.task,
        model_answer: "Not Set",
        marking_guidance: markingFieldOrNotSet(resolvedMarkingGuidance),
        pupil_answer: parsedSubmissionBody.extractedText ?? "",
        max_marks: typeof context.max_marks === "number" ? context.max_marks : 1,
        webhook_url: effectiveCallbackUrl,
        group_assignment_id: item.assignment_id,
        activity_id: context.activity_id as string,
        pupil_id: context.pupil_id as string,
        submission_id: item.submission_id,
      };

      await logQueueEvent(
        "info",
        `Triggering n8n workflow for worksheet submission ${item.submission_id}`,
      );

      await invokeAiMarking(doParams);
    }

    // Note: We don't mark as 'completed' here.
    // The webhook callback will do that.
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[marking-queue] Failed to process submission ${item.submission_id}:`,
      error,
    );
    await logQueueEvent("error", `Failed to process submission ${item.submission_id}`, {
      error: errorMessage,
    });

    const { rows: bumped } = await query<{ attempts: number }>(
      `update ai_marking_queue
         set attempts = attempts + 1,
             last_error = $1,
             process_after = now() + interval '30 seconds',
             updated_at = now()
       where submission_id = $2
       returning attempts`,
      [errorMessage, item.submission_id],
    );
    const attemptsNow = bumped[0]?.attempts ?? 3;
    const isRevision = item.assignment_id === "revision";
    if (attemptsNow >= 3) {
      if (isRevision) {
        await query(
          `update revision_answers set status='pending_manual' where answer_id=$1`,
          [item.submission_id],
        );
        await query(
          `delete from ai_marking_queue where submission_id=$1`,
          [item.submission_id],
        );
      } else {
        await query(
          `update submissions set mark_status='marking-error', mark_error=$1 where submission_id=$2`,
          [errorMessage, item.submission_id],
        );
        await query(
          `delete from ai_marking_queue where submission_id=$1`,
          [item.submission_id],
        );
        const { rows: idRows } = await query<{ activity_id: string; user_id: string }>(
          `select activity_id, user_id from submissions where submission_id=$1`,
          [item.submission_id],
        );
        void emitSubmissionEvent("submission.updated", {
          submissionId: item.submission_id,
          activityId: idRows[0]?.activity_id ?? "",
          pupilId: idRows[0]?.user_id ?? "",
          markStatus: "marking-error",
          markError: errorMessage,
        });
      }
    } else {
      if (isRevision) {
        await query(
          `update revision_answers set status='pending_marking' where answer_id=$1`,
          [item.submission_id],
        );
      } else {
        await query(
          `update submissions set mark_status='waiting' where submission_id=$1`,
          [item.submission_id],
        );
      }
    }
    // Re-throw to signal failure to Promise.allSettled (optional, but good for counting stats)
    throw error;
  }
}

export async function resolveQueueItem(submissionId: string) {
  await query(`delete from ai_marking_queue where submission_id=$1`, [submissionId]);
}

export async function triggerQueueProcessor(baseUrl?: string) {
  const secret = process.env.MARKING_QUEUE_SECRET;
  if (!secret) {
    console.error("[marking-queue] MARKING_QUEUE_SECRET not configured");
    return;
  }

  // Use provided baseUrl or fallback to env var
  let effectiveBaseUrl = baseUrl;
  if (!effectiveBaseUrl && process.env.AI_MARKING_CALLBACK_URL) {
    effectiveBaseUrl = process.env.AI_MARKING_CALLBACK_URL.replace(/\/$/, "");
  }

  if (!effectiveBaseUrl) {
    console.error("[marking-queue] No base URL available to trigger processor");
    return;
  }

  // Note: triggerQueueProcessor calls our INTERNAL API route, not the webhook.
  // The internal API route is likely /api/marking/process-queue (found in file list earlier)
  const url = `${effectiveBaseUrl}/api/marking/process-queue`;
  console.log(`[marking-queue] Triggering processor at: ${url}`);

  // Fire and forget
  void fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secret}`,
    },
  }).catch((err) => console.error("[marking-queue] Trigger failed:", err));
}

export async function pruneCompletedQueueItems() {
  await query(
    `delete from ai_marking_queue q using submissions s where s.submission_id = q.submission_id and s.mark_status in ('marked', 'marking-error')`,
  );
  await query(
    `delete from ai_marking_queue q using revision_answers r where r.answer_id=q.submission_id::uuid and r.status in ('marked','pending_manual')`,
  );
}

export async function recoverStuckItems() {
  await query(
    `update submissions set mark_status='waiting'
     where mark_status='marking'
       and submission_id in (select submission_id from ai_marking_queue where updated_at < now() - interval '10 minutes')`,
  );
  await query(
    `update revision_answers set status='pending_marking' where status='marking' and answer_id in (select submission_id::uuid from ai_marking_queue where updated_at < now() - interval '10 minutes')`,
  );
}
