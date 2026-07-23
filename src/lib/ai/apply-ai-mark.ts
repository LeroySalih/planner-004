import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ShortTextSubmissionBodySchema,
  UploadSpreadsheetSubmissionBodySchema,
  UploadWorksheetSubmissionBodySchema,
} from "@/types";
import {
  clampScore,
  fetchActivitySuccessCriteriaIds,
  normaliseSuccessCriteriaScores,
} from "@/lib/scoring/success-criteria";
import {
  type AssignmentResultsRealtimePayload,
  publishAssignmentResultsEvents,
} from "@/lib/results-sse";
import { emitSubmissionEvent } from "@/lib/sse/topics";
import { insertPupilActivityFeedbackEntry } from "@/lib/feedback/pupil-activity-feedback";
import { query } from "@/lib/db";
import { logQueueEvent, resolveQueueItem } from "@/lib/ai/marking-queue";
import { getNextAttemptNumber } from "@/lib/server-actions/submission-attempts";

const SHORT_TEXT_ACTIVITY_TYPE = "short-text-question";
const UPLOAD_SPREADSHEET_ACTIVITY_TYPE = "upload-spreadsheet";
const UPLOAD_WORKSHEET_ACTIVITY_TYPE = "upload-worksheet";
const MARK_WORKSHEET_ACTIVITY_TYPE = "mark-worksheet";
const AI_MARKABLE_ACTIVITY_TYPES = new Set([
  SHORT_TEXT_ACTIVITY_TYPE,
  UPLOAD_SPREADSHEET_ACTIVITY_TYPE,
  UPLOAD_WORKSHEET_ACTIVITY_TYPE,
  MARK_WORKSHEET_ACTIVITY_TYPE,
]);
const FILE_SUBMISSION_ACTIVITY_TYPES = new Set([
  UPLOAD_SPREADSHEET_ACTIVITY_TYPE,
  UPLOAD_WORKSHEET_ACTIVITY_TYPE,
  MARK_WORKSHEET_ACTIVITY_TYPE,
]);
const SHORT_TEXT_CORRECTNESS_THRESHOLD = 0.8;

const PupilAnswerSchema = z
  .object({
    pupilid: z.string().uuid().optional(),
    pupilId: z.string().uuid().optional(),
    pupil_id: z.string().uuid().optional(),
    answer: z.string().optional().nullable(),
  })
  .refine((value) => value.pupilid || value.pupilId || value.pupil_id, {
    message: "pupil identifier is required",
    path: ["pupilid"],
  });

const ResultEntrySchema = z
  .object({
    pupilid: z.string().uuid().optional(),
    pupilId: z.string().uuid().optional(),
    pupil_id: z.string().uuid().optional(),
    marks_awarded: z.number().min(0).optional(),
    score: z.number().min(0).optional(),
    max_marks: z.number().min(0).optional(),
    feedback: z.string().optional().nullable(),
  })
  .refine((value) => value.pupilid || value.pupilId || value.pupil_id, {
    message: "pupil identifier is required",
    path: ["pupilid"],
  })
  .refine((value) => value.marks_awarded != null || value.score != null, {
    message: "marks_awarded or score is required",
    path: ["marks_awarded"],
  });

const PayloadSchema = z.object({
  group_assignment_id: z.string().min(3),
  activity_id: z.string().uuid(),
  dataSent: z
    .object({
      group_assignment_id: z.string().min(3).optional(),
      activity_id: z.string().uuid().optional(),
      question: z.string().optional(),
      model_answer: z.string().optional(),
      pupil_answers: z.array(PupilAnswerSchema).optional(),
    })
    .passthrough()
    .optional(),
  results: z.array(ResultEntrySchema),
});

type WebhookPayload = z.infer<typeof PayloadSchema>;
type ResultEntry = z.infer<typeof ResultEntrySchema>;
type ResultPupil = string;

export interface ApplyAiMarkResult {
  ok: boolean;
  reason?: string;
  summary?: { updated: number; created: number; skipped: number; errors: number };
}

/**
 * Apply an inbound AI-mark webhook payload: validate, load the activity and
 * submissions, apply marks/feedback, and publish realtime events.
 *
 * Returns a structured result. Permanent conditions (invalid payload, activity
 * not found, unsupported type) return `ok:false`/`ok:true` without throwing so
 * the job is not retried. Transient failures (DB errors) throw so the queue
 * retries the job.
 */
export async function applyAiMarkPayload(json: unknown): Promise<ApplyAiMarkResult> {
  await logQueueEvent("info", "Applying AI-mark webhook payload", {
    resultCount: (json as { results?: unknown[] })?.results?.length,
  });

  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success) {
    await logQueueEvent("error", "Webhook payload validation failed", { error: parsed.error });
    return { ok: false, reason: "invalid_payload" };
  }

  if (parsed.data.results.length === 0) {
    return { ok: true, summary: { updated: 0, created: 0, skipped: 0, errors: 0 } };
  }

  const assignmentIdentifiers = decodeAssignmentIdentifier(parsed.data.group_assignment_id);
  if (!assignmentIdentifiers && parsed.data.group_assignment_id !== "revision") {
    await logQueueEvent("error", "Invalid group assignment identifier", {
      id: parsed.data.group_assignment_id,
    });
    return { ok: false, reason: "invalid_assignment" };
  }

  let activityRow: {
    activity_id: string;
    type: string | null;
    lesson_id: string | null;
    max_marks: number | null;
  } | null = null;
  const { rows } = await query<
    { activity_id: string; type: string | null; lesson_id: string | null; max_marks: number | null }
  >(
    `select activity_id, type, lesson_id, max_marks from activities where activity_id = $1 limit 1`,
    [parsed.data.activity_id],
  );
  activityRow = rows?.[0] ?? null;

  if (!activityRow) {
    return { ok: false, reason: "activity_not_found" };
  }

  if (!AI_MARKABLE_ACTIVITY_TYPES.has((activityRow.type ?? "").trim())) {
    return {
      ok: true,
      reason: "unsupported_activity_type",
      summary: { updated: 0, created: 0, skipped: parsed.data.results.length, errors: 0 },
    };
  }

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(parsed.data.activity_id);
  const pupilIds = parsed.data.results
    .map((entry) => resolveResultPupilId(entry))
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const { rows: submissionRows } = await query<
    { submission_id: string; user_id: string | null; body: unknown; submitted_at: string | null }
  >(
    `select submission_id, user_id, body, submitted_at from submissions where activity_id = $1 and user_id = any($2::text[])`,
    [parsed.data.activity_id, pupilIds],
  );

  const submissionsByPupil = new Map(
    (submissionRows ?? [])
      .filter((row) => typeof row.user_id === "string")
      .map((row) => [row.user_id as string, row]),
  );

  const answersByPupil = buildAnswersMap(parsed.data);
  const summary = { updated: 0, created: 0, skipped: 0, errors: 0 };
  const realtimeEvents: AssignmentResultsRealtimePayload[] = [];

  for (const result of parsed.data.results) {
    const resultPupilId = resolveResultPupilId(result);
    if (!resultPupilId) {
      await logQueueEvent("warn", "Webhook result missing pupil ID", { result });
      summary.skipped += 1;
      continue;
    }
    const existingSubmission = submissionsByPupil.get(resultPupilId) ?? null;

    try {
      if (existingSubmission) {
        const updated = await applyAiMarkToSubmission({
          submission: existingSubmission,
          result,
          activityId: parsed.data.activity_id,
          activityType: activityRow.type,
          maxMarks: activityRow.max_marks ?? 1,
          successCriteriaIds,
          answerFallback: answersByPupil.get(resultPupilId) ?? null,
          pupilId: resultPupilId,
        });
        if (updated?.updated) {
          summary.updated += 1;
          if (updated.payload) realtimeEvents.push(updated.payload);
          await resolveQueueItem(existingSubmission.submission_id);
        } else {
          summary.skipped += 1;
        }
      } else if (FILE_SUBMISSION_ACTIVITY_TYPES.has(activityRow.type ?? "")) {
        await logQueueEvent(
          "warn",
          `Skipped creating ${activityRow.type} submission for pupil ${resultPupilId}: no existing submission`,
          { activityId: parsed.data.activity_id, pupilId: resultPupilId },
        );
        summary.skipped += 1;
      } else {
        const created = await createAiMarkedSubmission({
          activityId: parsed.data.activity_id,
          pupilId: resultPupilId,
          result,
          maxMarks: activityRow.max_marks ?? 1,
          successCriteriaIds,
          answer: answersByPupil.get(resultPupilId) ?? null,
        });
        if (created?.created) {
          summary.created += 1;
          if (created.payload) {
            realtimeEvents.push(created.payload);
            if (created.payload.submissionId) {
              await resolveQueueItem(created.payload.submissionId);
            }
          }
        } else {
          summary.skipped += 1;
        }
      }
    } catch (error) {
      summary.errors += 1;
      console.error("[apply-ai-mark] Failed to apply AI mark for pupil", {
        pupilId: resultPupilId ?? "(unknown)",
        error,
      });
      await logQueueEvent("error", `Failed to apply AI mark for pupil ${resultPupilId}`, {
        error: String(error),
      });
    }
  }

  if (summary.errors === 0) {
    revalidatePath(`/results/assignments/${encodeURIComponent(parsed.data.group_assignment_id)}`);
  }

  if (realtimeEvents.length > 0) {
    try {
      await publishAssignmentResultsEvents(
        parsed.data.group_assignment_id,
        dedupeRealtimeEvents(realtimeEvents),
      );
    } catch (error) {
      console.error("[apply-ai-mark] Failed to publish realtime events", error);
    }
  }

  return { ok: true, summary };
}

function decodeAssignmentIdentifier(raw: string): { groupId: string; lessonId: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const [groupId, lessonId] = trimmed.split("__");
  if (!groupId || !lessonId) return null;
  return { groupId, lessonId };
}

function buildAnswersMap(payload: WebhookPayload): Map<string, string> {
  const map = new Map<string, string>();
  const answers = payload.dataSent?.pupil_answers ?? [];
  for (const entry of answers ?? []) {
    const pupilId = entry?.pupilid ?? entry?.pupilId ?? entry?.pupil_id;
    if (entry && typeof pupilId === "string" && typeof entry.answer === "string") {
      map.set(pupilId, entry.answer);
    }
  }
  return map;
}

function resolveResultPupilId(entry: ResultEntry): ResultPupil | null {
  return entry.pupilid ?? entry.pupilId ?? entry.pupil_id ?? null;
}

function computeIsCorrect(score: number | null): boolean {
  if (typeof score !== "number" || Number.isNaN(score)) return false;
  return score >= SHORT_TEXT_CORRECTNESS_THRESHOLD;
}

function scoreToMarks(score: number, maxMarks: number): number {
  if (score > 1) return Math.max(0, Math.min(maxMarks, Math.round(score)));
  const fraction = clampScore(score);
  return Math.max(0, Math.min(maxMarks, Math.round(fraction * maxMarks)));
}

function resolveAiMarks(
  result: { marks_awarded?: number | null; score?: number | null },
  maxMarks: number,
): number {
  if (typeof result.marks_awarded === "number") {
    return Math.max(0, Math.min(maxMarks, Math.round(result.marks_awarded)));
  }
  if (typeof result.score === "number") return scoreToMarks(result.score, maxMarks);
  return 0;
}

async function applyAiMarkToSubmission({
  submission,
  result,
  activityId,
  activityType,
  maxMarks,
  successCriteriaIds,
  answerFallback,
  pupilId,
}: {
  submission: { submission_id: string; user_id?: string | null; body: unknown; submitted_at?: string | null };
  result: ResultEntry;
  activityId: string;
  activityType: string | null;
  maxMarks: number;
  successCriteriaIds: string[];
  answerFallback: string | null;
  pupilId: string;
}): Promise<{ updated: boolean; payload: AssignmentResultsRealtimePayload | null }> {
  const isFileSubmission = FILE_SUBMISSION_ACTIVITY_TYPES.has(activityType ?? "");
  const submissionSchema =
    activityType === UPLOAD_WORKSHEET_ACTIVITY_TYPE || activityType === MARK_WORKSHEET_ACTIVITY_TYPE
      ? UploadWorksheetSubmissionBodySchema
      : activityType === UPLOAD_SPREADSHEET_ACTIVITY_TYPE
        ? UploadSpreadsheetSubmissionBodySchema
        : ShortTextSubmissionBodySchema;

  const parsedBody = submissionSchema.safeParse(submission.body ?? {});
  if (!parsedBody.success && isFileSubmission) {
    throw new Error(
      `Existing ${activityType} submission ${submission.submission_id} has an invalid body (missing required file fields).`,
    );
  }
  const baseBody = parsedBody.success ? parsedBody.data : ShortTextSubmissionBodySchema.parse({});

  const hasMarksOverride =
    typeof (baseBody as { marks_override?: number | null }).marks_override === "number" &&
    Number.isFinite((baseBody as { marks_override?: number | null }).marks_override);

  const aiMarks = resolveAiMarks(result, maxMarks);
  const aiScore = maxMarks > 0 ? aiMarks / maxMarks : 0;
  const effectiveScore = hasMarksOverride
    ? ((baseBody as { marks_override?: number | null }).marks_override ?? 0) / maxMarks
    : aiScore;
  const teacherFeedback = baseBody.teacher_feedback ?? null;
  const existingAiFeedback =
    typeof baseBody.ai_model_feedback === "string" && baseBody.ai_model_feedback.trim().length > 0
      ? baseBody.ai_model_feedback.trim()
      : null;
  const incomingAiFeedback = (result.feedback?.trim() ?? "") || null;
  const nextAiFeedback = incomingAiFeedback ?? existingAiFeedback ?? null;

  const nextBody = submissionSchema.parse({
    ...baseBody,
    ...(isFileSubmission
      ? {}
      : { answer: (baseBody as { answer?: string }).answer ?? answerFallback ?? "" }),
    ai_marks: aiMarks,
    marks: aiMarks,
    ai_model_score: aiScore,
    is_correct: computeIsCorrect(effectiveScore ?? null),
    teacher_feedback: teacherFeedback,
    ai_model_feedback: nextAiFeedback,
    success_criteria_scores: normaliseSuccessCriteriaScores({
      successCriteriaIds,
      fillValue: effectiveScore ?? 0,
    }),
  });

  await query(`update submissions set body = $1 where submission_id = $2`, [nextBody, submission.submission_id]);
  await query(
    `update submissions set mark_status='marked', mark_error=null where submission_id=$1`,
    [submission.submission_id],
  );

  void emitSubmissionEvent("submission.updated", {
    submissionId: submission.submission_id,
    activityId,
    pupilId,
    markStatus: "marked",
    markedAt: new Date().toISOString(),
  });

  await insertPupilActivityFeedbackEntry({
    activityId,
    pupilId,
    submissionId: submission.submission_id,
    source: "ai",
    score: aiScore,
    feedbackText: nextAiFeedback,
    createdBy: null,
  });

  return {
    updated: true,
    payload: buildRealtimePayload({
      submissionId: submission.submission_id,
      pupilId: (submission.user_id as string) ?? null,
      activityId,
      aiScore,
      aiFeedback: nextAiFeedback,
      successCriteriaScores: nextBody.success_criteria_scores ?? {},
    }),
  };
}

async function createAiMarkedSubmission({
  activityId,
  pupilId,
  result,
  maxMarks,
  successCriteriaIds,
  answer,
}: {
  activityId: string;
  pupilId: string;
  result: ResultEntry;
  maxMarks: number;
  successCriteriaIds: string[];
  answer: string | null;
}): Promise<{ created: boolean; payload: AssignmentResultsRealtimePayload | null }> {
  const marks = resolveAiMarks(result, maxMarks);
  const score = maxMarks > 0 ? marks / maxMarks : 0;
  const successCriteriaScores = normaliseSuccessCriteriaScores({ successCriteriaIds, fillValue: score });

  const submissionBody = ShortTextSubmissionBodySchema.parse({
    answer: answer ?? "",
    ai_marks: marks,
    marks_override: null,
    teacher_feedback: null,
    ai_model_feedback: (result.feedback?.trim() ?? "") || null,
    is_correct: computeIsCorrect(score),
    success_criteria_scores: successCriteriaScores,
  });

  const attemptNumber = await getNextAttemptNumber(activityId, pupilId);
  const { rows } = await query<{ submission_id: string }>(
    `insert into submissions (activity_id, user_id, attempt_number, submitted_at, body) values ($1, $2, $3, $4, $5) returning submission_id`,
    [activityId, pupilId, attemptNumber, new Date().toISOString(), submissionBody],
  );

  const insertedRow = rows?.[0] ?? null;

  await insertPupilActivityFeedbackEntry({
    activityId,
    pupilId,
    submissionId: insertedRow?.submission_id ?? null,
    source: "ai",
    score,
    feedbackText: submissionBody.ai_model_feedback ?? null,
    createdBy: null,
  });

  return {
    created: true,
    payload: buildRealtimePayload({
      submissionId: insertedRow?.submission_id ?? null,
      pupilId,
      activityId,
      aiScore: score,
      aiFeedback: submissionBody.ai_model_feedback ?? null,
      successCriteriaScores: successCriteriaScores ?? {},
    }),
  };
}

function buildRealtimePayload(input: {
  submissionId?: string | null;
  pupilId?: string | null;
  activityId?: string | null;
  aiScore?: number | null;
  aiFeedback?: string | null;
  successCriteriaScores?: Record<string, number | null> | null;
}): AssignmentResultsRealtimePayload | null {
  if (!input.activityId || !input.pupilId) return null;
  return {
    submissionId: input.submissionId ?? null,
    pupilId: input.pupilId,
    activityId: input.activityId,
    aiScore: typeof input.aiScore === "number" ? clampScore(input.aiScore) : null,
    aiFeedback: input.aiFeedback ?? null,
    successCriteriaScores: Object.entries(input.successCriteriaScores ?? {}).reduce<Record<string, number>>(
      (acc, [key, value]) => {
        if (typeof value === "number" && Number.isFinite(value)) acc[key] = clampScore(value);
        return acc;
      },
      {},
    ),
  };
}

function dedupeRealtimeEvents(
  events: AssignmentResultsRealtimePayload[],
): AssignmentResultsRealtimePayload[] {
  const seen = new Set<string>();
  const result: AssignmentResultsRealtimePayload[] = [];
  for (const event of events) {
    const key = `${event.activityId ?? ""}::${event.pupilId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }
  return result;
}
