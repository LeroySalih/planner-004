"use server"

import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"

export async function upsertDoFlashcardsSubmissionAction(input: {
  doActivityId: string
  pupilId: string
  sessionId: string
  correctCount: number
  totalCards: number
  submissionId: string | null
  isFinal?: boolean
}): Promise<{ data: { submissionId: string } | null; error: string | null }> {
  return withTelemetry(
    {
      routeTag: "/do-flashcards:upsert-submission",
      functionName: "upsertDoFlashcardsSubmissionAction",
      params: { doActivityId: input.doActivityId, sessionId: input.sessionId },
    },
    async () => {
      const { doActivityId, pupilId, sessionId, correctCount, totalCards, submissionId, isFinal } = input

      if (!doActivityId || !pupilId || !sessionId) {
        return { data: null, error: "Missing required fields." }
      }

      // CRITICAL: The body MUST include a `score` field (0-1 float).
      // compute_submission_base_score reads body->>'score' for this activity type.
      // If `score` is absent, the activity will show as unscored in all grids.
      const score = totalCards > 0 ? Math.min(1, correctCount / totalCards) : 0
      const body = JSON.stringify({ score, correctCount, totalCards, sessionId })

      try {
        if (submissionId === null) {
          // First attempt: INSERT new submission row
          const result = await query<{ submission_id: string }>(
            `
            INSERT INTO submissions (submission_id, activity_id, user_id, body, is_flagged${isFinal ? ", submitted_at" : ""})
            VALUES (gen_random_uuid(), $1, $2, $3, false${isFinal ? ", now()" : ""})
            RETURNING submission_id
            `,
            [doActivityId, pupilId, body],
          )
          return { data: { submissionId: result.rows[0].submission_id }, error: null }
        } else {
          // Subsequent attempts: UPDATE existing row
          await query(
            `
            UPDATE submissions
            SET body = $1${isFinal ? ", submitted_at = now()" : ""}
            WHERE submission_id = $2
            `,
            [body, submissionId],
          )
          return { data: { submissionId }, error: null }
        }
      } catch (error) {
        console.error("[do-flashcards] Failed to upsert submission", error)
        const message = error instanceof Error ? error.message : "Unable to save flashcard score."
        return { data: null, error: message }
      }
    },
  )
}

/**
 * Reads all display-flashcards activities in the same unit as a given lesson,
 * for populating the teacher sidebar dropdown.
 */
export async function readUnitFlashcardActivitiesAction(
  lessonId: string,
): Promise<{ data: Array<{ activityId: string; title: string }> | null; error: string | null }> {
  return withTelemetry(
    {
      routeTag: "/do-flashcards:read-unit-flashcard-activities",
      functionName: "readUnitFlashcardActivitiesAction",
      params: { lessonId },
    },
    async () => {
      if (!lessonId) {
        return { data: null, error: "Missing lesson ID." }
      }

      try {
        const result = await query<{ activity_id: string; title: string | null }>(
          `
          SELECT a.activity_id, a.title
          FROM activities a
          JOIN lessons l ON l.lesson_id = a.lesson_id
          WHERE a.type = 'display-flashcards'
            AND coalesce(a.active, true) = true
            AND l.unit_id = (
              SELECT unit_id FROM lessons WHERE lesson_id = $1 LIMIT 1
            )
          ORDER BY l.order_by ASC NULLS LAST, a.order_by ASC NULLS LAST
          `,
          [lessonId],
        )
        return {
          data: result.rows.map((row) => ({
            activityId: row.activity_id,
            title: row.title ?? "Flashcards",
          })),
          error: null,
        }
      } catch (error) {
        console.error("[do-flashcards] Failed to read unit flashcard activities", error)
        const message = error instanceof Error ? error.message : "Unable to load flashcard sets."
        return { data: null, error: message }
      }
    },
  )
}
