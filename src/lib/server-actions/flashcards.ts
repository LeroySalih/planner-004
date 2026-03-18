"use server"

import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"
import { readPupilUnitsBootstrapAction } from "@/lib/server-actions/pupil-units"
import { parseFlashcardLines, type FlashCard } from "@/lib/flashcards/parse-flashcards"
import { emitFlashcardEvent } from "@/lib/sse/topics"

type TelemetryOptions = { authEndTime?: number | null; routeTag?: string }

export type FlashcardActivity = {
  activityId: string
  activityTitle: string
  lessonId: string
  lessonTitle: string
  lastSession?: {
    completedAt: string   // ISO string
    score: number         // correct_count / total_cards, 0–1
  }
}

export async function readFlashcardsBootstrapAction(
  pupilId: string,
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/flashcards:bootstrap"

  return withTelemetry(
    {
      routeTag,
      functionName: "readFlashcardsBootstrapAction",
      params: { pupilId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      if (!pupilId || pupilId.trim().length === 0) {
        return { data: null, error: "Missing pupil identifier." }
      }

      try {
        const bootstrapResult = await readPupilUnitsBootstrapAction(pupilId, {
          routeTag: "/flashcards:pupil-units",
          authEndTime: options?.authEndTime ?? null,
        })

        if (bootstrapResult.error || !bootstrapResult.data) {
          return { data: null, error: bootstrapResult.error ?? "Failed to load pupil data." }
        }

        const { subjects } = bootstrapResult.data

        const allLessonIds: string[] = []
        for (const subject of subjects) {
          for (const unit of subject.units) {
            for (const lesson of unit.lessons) {
              allLessonIds.push(lesson.lessonId)
            }
          }
        }

        let flashcardActivities: FlashcardActivity[] = []
        if (allLessonIds.length > 0) {
          const result = await query<{
            activity_id: string
            title: string | null
            lesson_id: string
            lesson_title: string | null
          }>(
            `
            SELECT a.activity_id, a.title, a.lesson_id,
                   coalesce(l.title, 'Untitled lesson') as lesson_title
            FROM activities a
            JOIN lessons l ON l.lesson_id = a.lesson_id
            WHERE a.type = 'display-flashcards'
              AND coalesce(a.active, true) = true
              AND a.lesson_id = ANY($1::text[])
            ORDER BY l.order_by ASC NULLS LAST, a.order_by ASC NULLS LAST
            `,
            [allLessonIds],
          )
          flashcardActivities = result.rows.map((row) => ({
            activityId: row.activity_id,
            activityTitle: row.title ?? "Flashcards",
            lessonId: row.lesson_id,
            lessonTitle: row.lesson_title ?? "Untitled lesson",
          }))
        }

        // Fetch most recent completed session per activity for this pupil
        if (flashcardActivities.length > 0) {
          const activityIds = flashcardActivities.map((a) => a.activityId)
          const sessionResult = await query<{
            activity_id: string
            completed_at: Date
            correct_count: number
            total_cards: number
          }>(
            `
            SELECT DISTINCT ON (activity_id)
              activity_id,
              completed_at,
              correct_count::integer,
              total_cards::integer
            FROM flashcard_sessions
            WHERE pupil_id = $1
              AND status = 'completed'
              AND activity_id = ANY($2::text[])
            ORDER BY activity_id, completed_at DESC
            `,
            [pupilId, activityIds],
          )

          const sessionMap = new Map(
            sessionResult.rows.map((row) => [
              row.activity_id,
              {
                completedAt: row.completed_at.toISOString(),
                score: row.total_cards > 0 ? row.correct_count / row.total_cards : 0,
              },
            ]),
          )

          flashcardActivities = flashcardActivities.map((a) => ({
            ...a,
            lastSession: sessionMap.get(a.activityId),
          }))
        }

        return {
          data: { subjects, flashcardActivities },
          error: null,
        }
      } catch (error) {
        console.error("[flashcards] Failed to load bootstrap", error)
        const message = error instanceof Error ? error.message : "Unable to load flashcard data."
        return { data: null, error: message }
      }
    },
  )
}

export async function readFlashcardDeckAction(
  activityId: string,
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/flashcards:deck"

  return withTelemetry(
    {
      routeTag,
      functionName: "readFlashcardDeckAction",
      params: { activityId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      if (!activityId || activityId.trim().length === 0) {
        return { data: null, error: "Missing activity identifier." }
      }

      try {
        const result = await query<{
          activity_id: string
          title: string | null
          body_data: Record<string, unknown> | null
          lesson_title: string | null
        }>(
          `
          SELECT a.activity_id, a.title, a.body_data,
                 coalesce(l.title, 'Untitled lesson') as lesson_title
          FROM activities a
          JOIN lessons l ON l.lesson_id = a.lesson_id
          WHERE a.activity_id = $1
            AND a.type = 'display-flashcards'
            AND coalesce(a.active, true) = true
          LIMIT 1
          `,
          [activityId],
        )

        if (result.rows.length === 0) {
          return { data: null, error: "Activity not found." }
        }

        const row = result.rows[0]
        const activityTitle = row.title ?? "Flashcards"
        const lessonTitle = row.lesson_title ?? "Untitled lesson"

        let cards: FlashCard[] = []
        if (row.body_data && typeof row.body_data === "object") {
          const lines = (row.body_data as Record<string, unknown>).lines
          if (typeof lines === "string") {
            cards = parseFlashcardLines(lines)
          }
        }

        return {
          data: { activityId, activityTitle, lessonTitle, cards },
          error: null,
        }
      } catch (error) {
        console.error("[flashcards] Failed to load deck", error)
        const message = error instanceof Error ? error.message : "Unable to load flashcard deck."
        return { data: null, error: message }
      }
    },
  )
}

export async function startFlashcardSessionAction(
  activityId: string,
  totalCards: number,
  pupilId: string,
  activityTitle?: string,
  doActivityId?: string,
) {
  return withTelemetry(
    {
      routeTag: "/flashcards:start-session",
      functionName: "startFlashcardSessionAction",
      params: { activityId, totalCards, pupilId },
    },
    async () => {
      try {
        const result = await query<{ session_id: string }>(
          `
          INSERT INTO flashcard_sessions (pupil_id, activity_id, total_cards, do_activity_id)
          VALUES ($1, $2, $3, $4)
          RETURNING session_id
          `,
          [pupilId, activityId, totalCards, doActivityId ?? null],
        )

        const sessionId = result.rows[0].session_id
        void emitFlashcardEvent("flashcard.start", {
          pupilId, activityId, sessionId, consecutiveCorrect: 0, totalCards, status: "in_progress",
          ...(activityTitle !== undefined && { activityTitle }),
        })

        return { data: { sessionId }, error: null }
      } catch (error) {
        console.error("[flashcards] Failed to start session", error)
        const message = error instanceof Error ? error.message : "Unable to start flashcard session."
        return { data: null, error: message }
      }
    },
  )
}

export async function recordFlashcardAttemptAction(input: {
  sessionId: string
  term: string
  definition: string
  chosenDefinition: string
  isCorrect: boolean
  attemptNumber: number
  progress?: {
    pupilId: string
    activityId: string
    consecutiveCorrect: number
    totalCards: number
    correctCount?: number
    wrongCount?: number
  }
}) {
  return withTelemetry(
    {
      routeTag: "/flashcards:record-attempt",
      functionName: "recordFlashcardAttemptAction",
      params: { sessionId: input.sessionId },
    },
    async () => {
      try {
        await query(
          `
          INSERT INTO flashcard_attempts (session_id, term, definition, chosen_definition, is_correct, attempt_number)
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            input.sessionId,
            input.term,
            input.definition,
            input.chosenDefinition,
            input.isCorrect,
            input.attemptNumber,
          ],
        )

        if (input.progress) {
          const { pupilId, activityId, consecutiveCorrect, totalCards } = input.progress
          void emitFlashcardEvent("flashcard.progress", {
            pupilId,
            activityId,
            sessionId: input.sessionId,
            consecutiveCorrect,
            totalCards,
            status: "in_progress",
            ...(input.progress.correctCount !== undefined && { correctCount: input.progress.correctCount }),
            ...(input.progress.wrongCount !== undefined && { wrongCount: input.progress.wrongCount }),
          })
        }

        return { data: { success: true }, error: null }
      } catch (error) {
        console.error("[flashcards] Failed to record attempt", error)
        const message = error instanceof Error ? error.message : "Unable to record attempt."
        return { data: null, error: message }
      }
    },
  )
}

export async function completeFlashcardSessionAction(
  sessionId: string,
  correctCount: number,
  progress?: { pupilId: string; activityId: string; totalCards: number },
) {
  return withTelemetry(
    {
      routeTag: "/flashcards:complete-session",
      functionName: "completeFlashcardSessionAction",
      params: { sessionId, correctCount },
    },
    async () => {
      try {
        await query(
          `
          UPDATE flashcard_sessions
          SET status = 'completed', completed_at = now(), correct_count = $1
          WHERE session_id = $2 AND status = 'in_progress'
          `,
          [correctCount, sessionId],
        )

        if (progress) {
          void emitFlashcardEvent("flashcard.complete", {
            pupilId: progress.pupilId, activityId: progress.activityId, sessionId,
            consecutiveCorrect: progress.totalCards, totalCards: progress.totalCards,
            status: "completed",
          })
        }

        return { data: { success: true }, error: null }
      } catch (error) {
        console.error("[flashcards] Failed to complete session", error)
        const message = error instanceof Error ? error.message : "Unable to complete session."
        return { data: null, error: message }
      }
    },
  )
}
