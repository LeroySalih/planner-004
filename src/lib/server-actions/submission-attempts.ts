"use server";

import { query } from "@/lib/db";
import { SubmissionSchema, type Submission } from "@/types";

export async function getNextAttemptNumber(
  activityId: string,
  userId: string,
): Promise<number> {
  const { rows } = await query<{ next_attempt: number }>(
    `
      select coalesce(max(attempt_number), 0) + 1 as next_attempt
      from submissions
      where activity_id = $1 and user_id = $2
    `,
    [activityId, userId],
  );
  return rows[0]?.next_attempt ?? 1;
}

export async function clearResubmitRequest(
  activityId: string,
  userId: string,
): Promise<void> {
  await query(
    `delete from submission_resubmit_requests where activity_id = $1 and user_id = $2`,
    [activityId, userId],
  );
}

export async function setResubmitRequest(input: {
  activityId: string;
  userId: string;
  note: string | null;
  requestedBy: string | null;
}): Promise<void> {
  await query(
    `
      insert into submission_resubmit_requests (activity_id, user_id, requested, note, requested_by)
      values ($1, $2, true, $3, $4)
      on conflict (activity_id, user_id)
      do update set requested = true, note = $3, requested_by = $4, requested_at = now()
    `,
    [input.activityId, input.userId, input.note, input.requestedBy],
  );
}

export async function getResubmitRequest(
  activityId: string,
  userId: string,
): Promise<{ requested: boolean; note: string | null } | null> {
  const { rows } = await query<{ requested: boolean; note: string | null }>(
    `
      select requested, note
      from submission_resubmit_requests
      where activity_id = $1 and user_id = $2
    `,
    [activityId, userId],
  );
  return rows[0] ?? null;
}

export async function readSubmissionAttemptsAction(
  activityId: string,
  userId: string,
): Promise<{ data: Submission[]; error: string | null }> {
  try {
    const { rows } = await query(
      `
        select *
        from submissions
        where activity_id = $1 and user_id = $2
        order by attempt_number asc
      `,
      [activityId, userId],
    );

    const parsed = SubmissionSchema.array().safeParse(rows ?? []);
    if (!parsed.success) {
      console.error(
        "[submission-attempts] Failed to parse attempt rows:",
        parsed.error,
      );
      return { data: [], error: "Invalid submission data." };
    }

    return { data: parsed.data, error: null };
  } catch (error) {
    console.error(
      "[submission-attempts] Failed to read submission attempts:",
      error,
    );
    const message = error instanceof Error
      ? error.message
      : "Unable to load submission attempts.";
    return { data: [], error: message };
  }
}

/**
 * Save an in-progress answer for an activity the pupil edits one piece at a
 * time — matching and grouping, where every selection saves.
 *
 * Those saves used to INSERT, so an eight-pair matcher left eight attempts
 * behind, each holding one more answer than the last. That filled the Attempts
 * list with noise and made "which attempt is current" depend on ordering, which
 * is how a teacher came to be shown a pupil's seventh, incomplete attempt as
 * their mark.
 *
 * The pupil's current attempt is now rewritten in place. A new attempt starts
 * only when the teacher has asked for a resubmission — the one case where the
 * earlier answer is worth keeping as its own attempt.
 */
export async function saveInProgressSubmission(input: {
  activityId: string;
  userId: string;
  body: unknown;
  submittedAt: string;
}): Promise<Submission | null> {
  const { activityId, userId, body, submittedAt } = input;

  const { rows: currentRows } = await query<{ submission_id: string }>(
    `
      select s.submission_id
      from submissions s
      where s.activity_id = $1
        and s.user_id = $2
        and not exists (
          select 1 from submission_resubmit_requests r
          where r.activity_id = s.activity_id and r.user_id = s.user_id and r.requested
        )
      order by s.attempt_number desc nulls last, s.submitted_at desc nulls last
      limit 1
    `,
    [activityId, userId],
  );

  const currentSubmissionId = currentRows[0]?.submission_id ?? null;

  const { rows } = currentSubmissionId
    ? await query(
      `
        update submissions
        set body = $2, submitted_at = $3
        where submission_id = $1
        returning *
      `,
      [currentSubmissionId, body, submittedAt],
    )
    : await query(
      `
        insert into submissions (activity_id, user_id, attempt_number, body, submitted_at)
        values ($1, $2, $3, $4, $5)
        returning *
      `,
      [
        activityId,
        userId,
        await getNextAttemptNumber(activityId, userId),
        body,
        submittedAt,
      ],
    );

  const parsed = SubmissionSchema.safeParse(rows?.[0]);
  return parsed.success ? parsed.data : null;
}
