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
