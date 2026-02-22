"use server"

import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"
import { readPupilUnitsBootstrapAction } from "@/lib/server-actions/pupil-units"
import { parseKeyTermsMarkdown, type KeyTerm } from "@/lib/flashcards/parse-key-terms"
import { emitFlashcardEvent } from "@/lib/sse/topics"

type TelemetryOptions = { authEndTime?: number | null; routeTag?: string }

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

        let lessonsWithKeyTerms: string[] = []
        if (allLessonIds.length > 0) {
          const result = await query<{ lesson_id: string }>(
            `
            SELECT DISTINCT lesson_id
            FROM activities
            WHERE type = 'display-key-terms'
              AND coalesce(active, true) = true
              AND lesson_id = ANY($1::text[])
            `,
            [allLessonIds],
          )
          lessonsWithKeyTerms = result.rows.map((row) => row.lesson_id)
        }

        return {
          data: { subjects, lessonsWithKeyTerms },
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
  lessonId: string,
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/flashcards:deck"

  return withTelemetry(
    {
      routeTag,
      functionName: "readFlashcardDeckAction",
      params: { lessonId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      if (!lessonId || lessonId.trim().length === 0) {
        return { data: null, error: "Missing lesson identifier." }
      }

      try {
        const [lessonResult, activitiesResult] = await Promise.all([
          query<{ title: string }>(
            `SELECT coalesce(title, 'Untitled lesson') as title FROM lessons WHERE lesson_id = $1 LIMIT 1`,
            [lessonId],
          ),
          query<{ body_data: Record<string, unknown> | null }>(
            `
            SELECT body_data
            FROM activities
            WHERE lesson_id = $1
              AND type = 'display-key-terms'
              AND coalesce(active, true) = true
            ORDER BY order_by ASC NULLS LAST
            `,
            [lessonId],
          ),
        ])

        const lessonTitle = lessonResult.rows[0]?.title ?? "Untitled lesson"

        const allTerms: KeyTerm[] = []
        const seenTerms = new Set<string>()

        for (const row of activitiesResult.rows) {
          if (!row.body_data || typeof row.body_data !== "object") continue
          const markdown = (row.body_data as Record<string, unknown>).markdown
          if (typeof markdown !== "string") continue

          const parsed = parseKeyTermsMarkdown(markdown)
          for (const term of parsed) {
            const key = term.term.toLowerCase().trim()
            if (!seenTerms.has(key)) {
              seenTerms.add(key)
              allTerms.push(term)
            }
          }
        }

        return {
          data: { lessonId, lessonTitle, terms: allTerms },
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
  lessonId: string,
  totalCards: number,
  pupilId: string,
) {
  return withTelemetry(
    {
      routeTag: "/flashcards:start-session",
      functionName: "startFlashcardSessionAction",
      params: { lessonId, totalCards, pupilId },
    },
    async () => {
      try {
        const result = await query<{ session_id: string }>(
          `
          INSERT INTO flashcard_sessions (pupil_id, lesson_id, total_cards)
          VALUES ($1, $2, $3)
          RETURNING session_id
          `,
          [pupilId, lessonId, totalCards],
        )

        const sessionId = result.rows[0].session_id
        void emitFlashcardEvent("flashcard.start", {
          pupilId, lessonId, sessionId, consecutiveCorrect: 0, totalCards, status: "in_progress",
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
    lessonId: string
    consecutiveCorrect: number
    totalCards: number
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
          const { pupilId, lessonId, consecutiveCorrect, totalCards } = input.progress
          void emitFlashcardEvent("flashcard.progress", {
            pupilId, lessonId, sessionId: input.sessionId,
            consecutiveCorrect, totalCards, status: "in_progress",
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
  progress?: { pupilId: string; lessonId: string; totalCards: number },
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
            pupilId: progress.pupilId, lessonId: progress.lessonId, sessionId,
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
