"use server";

import { query } from "@/lib/db";

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
