import { query } from "@/lib/db"

type LogActivitySubmissionEventInput = {
  submissionId: string | null
  activityId: string
  lessonId: string | null
  pupilId: string
  fileName: string | null
  submittedAt: string
}

/**
 * Audit trail for activity submissions across all activity types.
 * This should never block the user: errors are logged and ignored.
 */
export async function logActivitySubmissionEvent(input: LogActivitySubmissionEventInput) {
  const { submissionId, activityId, lessonId, pupilId, fileName, submittedAt } = input

  if (!lessonId) {
    console.warn("[submission-events] lessonId missing; skipping submission event log", {
      activityId,
      pupilId,
    })
    return
  }

  try {
    await query(
      `
        insert into activity_submission_events (
          submission_id,
          activity_id,
          lesson_id,
          pupil_id,
          file_name,
          submitted_at
        ) values ($1, $2, $3, $4, $5, $6)
      `,
      [submissionId, activityId, lessonId, pupilId, fileName, submittedAt],
    )
  } catch (error) {
    console.error("[submission-events] Failed to log activity submission event", {
      activityId,
      lessonId,
      pupilId,
      error,
    })
  }
}

export async function getActivityLessonId(activityId: string): Promise<string | null> {
  try {
    const { rows } = await query<{ lesson_id: string | null }>(
      "select lesson_id from activities where activity_id = $1 limit 1",
      [activityId],
    )
    return rows[0]?.lesson_id ?? null
  } catch (error) {
    console.error("[submission-events] Failed to resolve lesson_id for activity", { activityId, error })
    return null
  }
}
