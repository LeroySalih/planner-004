"use server"

import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"
import { requireTeacherProfile } from "@/lib/auth"

type TelemetryOptions = { authEndTime?: number | null; routeTag?: string }

export async function readLiveFlashcardMonitorAction(
  groupId: string,
  activityId: string,
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/flashcard-monitor:live"

  return withTelemetry(
    {
      routeTag,
      functionName: "readLiveFlashcardMonitorAction",
      params: { groupId, activityId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      await requireTeacherProfile()

      try {
        const [membersResult, activityResult] = await Promise.all([
          query<{ user_id: string; first_name: string | null; last_name: string | null }>(
            `SELECT gm.user_id, p.first_name, p.last_name
             FROM group_membership gm
             JOIN profiles p ON p.user_id = gm.user_id
             WHERE gm.group_id = $1
             ORDER BY p.first_name, p.last_name`,
            [groupId],
          ),
          query<{ title: string }>(
            `SELECT coalesce(a.title, 'Flashcards') as title
             FROM activities a
             WHERE a.activity_id = $1 LIMIT 1`,
            [activityId],
          ),
        ])

        const pupilIds = membersResult.rows.map((r) => r.user_id)
        const activityTitle = activityResult.rows[0]?.title ?? "Flashcards"

        let sessionMap = new Map<string, {
          session_id: string
          status: string
          total_cards: number
          correct_count: number
        }>()

        if (pupilIds.length > 0) {
          const sessionsResult = await query<{
            pupil_id: string
            session_id: string
            status: string
            total_cards: number
            correct_count: number
          }>(
            `SELECT DISTINCT ON (pupil_id)
               pupil_id, session_id, status, total_cards, coalesce(correct_count, 0) as correct_count
             FROM flashcard_sessions
             WHERE activity_id = $1 AND pupil_id = ANY($2::text[])
             ORDER BY pupil_id, started_at DESC`,
            [activityId, pupilIds],
          )

          for (const row of sessionsResult.rows) {
            sessionMap.set(row.pupil_id, {
              session_id: row.session_id,
              status: row.status,
              total_cards: row.total_cards,
              correct_count: row.correct_count,
            })
          }
        }

        const pupils = membersResult.rows.map((m) => {
          const session = sessionMap.get(m.user_id)
          return {
            pupilId: m.user_id,
            firstName: m.first_name ?? "",
            lastName: m.last_name ?? "",
            sessionId: session?.session_id ?? null,
            status: (session?.status ?? "not_started") as "not_started" | "in_progress" | "completed",
            totalCards: session?.total_cards ?? 0,
            correctCount: session?.correct_count ?? 0,
          }
        })

        return { data: { pupils, activityTitle }, error: null }
      } catch (error) {
        console.error("[flashcard-monitor] Failed to load live monitor", error)
        const message = error instanceof Error ? error.message : "Unable to load monitor data."
        return { data: null, error: message }
      }
    },
  )
}

export async function readStudyTrackerAction(
  groupId: string,
  unitId: string,
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/flashcard-monitor:study"

  return withTelemetry(
    {
      routeTag,
      functionName: "readStudyTrackerAction",
      params: { groupId, unitId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      await requireTeacherProfile()

      try {
        const [activitiesResult, membersResult, unitResult] = await Promise.all([
          query<{ activity_id: string; title: string | null; lesson_id: string }>(
            `SELECT a.activity_id, a.title, a.lesson_id
             FROM activities a
             JOIN lessons l ON l.lesson_id = a.lesson_id
             WHERE l.unit_id = $1
               AND a.type = 'display-flashcards'
               AND coalesce(a.active, true) = true
               AND coalesce(l.active, true) = true
             ORDER BY l.order_by ASC NULLS LAST, a.order_by ASC NULLS LAST`,
            [unitId],
          ),
          query<{ user_id: string; first_name: string | null; last_name: string | null }>(
            `SELECT gm.user_id, p.first_name, p.last_name
             FROM group_membership gm
             JOIN profiles p ON p.user_id = gm.user_id
             WHERE gm.group_id = $1
             ORDER BY p.first_name, p.last_name`,
            [groupId],
          ),
          query<{ title: string }>(
            `SELECT coalesce(title, 'Untitled unit') as title FROM units WHERE unit_id = $1 LIMIT 1`,
            [unitId],
          ),
        ])

        const activityIds = activitiesResult.rows.map((r) => r.activity_id)
        const pupilIds = membersResult.rows.map((r) => r.user_id)
        const unitTitle = unitResult.rows[0]?.title ?? "Untitled unit"

        let cells: { pupilId: string; activityId: string; startedAt: string; completedAt: string | null; status: string }[] = []

        if (activityIds.length > 0 && pupilIds.length > 0) {
          const cellsResult = await query<{
            pupil_id: string
            activity_id: string
            started_at: string
            completed_at: string | null
            status: string
          }>(
            `SELECT DISTINCT ON (pupil_id, activity_id)
               pupil_id, activity_id, started_at, completed_at, status
             FROM flashcard_sessions
             WHERE activity_id = ANY($1::text[])
               AND pupil_id = ANY($2::text[])
             ORDER BY pupil_id, activity_id,
               CASE WHEN status = 'completed' THEN 0 ELSE 1 END,
               started_at DESC`,
            [activityIds, pupilIds],
          )

          cells = cellsResult.rows.map((r) => ({
            pupilId: r.pupil_id,
            activityId: r.activity_id,
            startedAt: r.started_at,
            completedAt: r.completed_at,
            status: r.status,
          }))
        }

        const activities = activitiesResult.rows.map((r) => ({
          activityId: r.activity_id,
          activityTitle: r.title ?? "Flashcards",
        }))

        const pupils = membersResult.rows.map((r) => ({
          pupilId: r.user_id,
          firstName: r.first_name ?? "",
          lastName: r.last_name ?? "",
        }))

        return { data: { activities, pupils, cells, unitTitle }, error: null }
      } catch (error) {
        console.error("[flashcard-monitor] Failed to load study tracker", error)
        const message = error instanceof Error ? error.message : "Unable to load study tracker data."
        return { data: null, error: message }
      }
    },
  )
}

export async function readFlashcardSessionDetailAction(
  pupilId: string,
  unitId: string,
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/flashcard-monitor:session-detail"

  return withTelemetry(
    {
      routeTag,
      functionName: "readFlashcardSessionDetailAction",
      params: { pupilId, unitId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      await requireTeacherProfile()

      try {
        const [profileResult, activitiesResult] = await Promise.all([
          query<{ first_name: string | null; last_name: string | null }>(
            `SELECT first_name, last_name FROM profiles WHERE user_id = $1 LIMIT 1`,
            [pupilId],
          ),
          query<{ activity_id: string; title: string | null }>(
            `SELECT a.activity_id, a.title
             FROM activities a
             JOIN lessons l ON l.lesson_id = a.lesson_id
             WHERE l.unit_id = $1
               AND a.type = 'display-flashcards'
               AND coalesce(a.active, true) = true
               AND coalesce(l.active, true) = true
             ORDER BY l.order_by ASC NULLS LAST, a.order_by ASC NULLS LAST`,
            [unitId],
          ),
        ])

        const pupilName = [
          profileResult.rows[0]?.first_name ?? "",
          profileResult.rows[0]?.last_name ?? "",
        ].filter(Boolean).join(" ") || "Unknown pupil"

        const activityIds = activitiesResult.rows.map((r) => r.activity_id)
        const activityTitleMap = new Map(activitiesResult.rows.map((r) => [r.activity_id, r.title ?? "Flashcards"]))

        let sessions: {
          session_id: string
          activity_id: string
          status: string
          started_at: string
          completed_at: string | null
          total_cards: number
          correct_count: number
        }[] = []

        if (activityIds.length > 0) {
          const sessionsResult = await query<{
            session_id: string
            activity_id: string
            status: string
            started_at: string
            completed_at: string | null
            total_cards: number
            correct_count: number
          }>(
            `SELECT session_id, activity_id, status, started_at, completed_at, total_cards, coalesce(correct_count, 0) as correct_count
             FROM flashcard_sessions
             WHERE pupil_id = $1 AND activity_id = ANY($2::text[])
             ORDER BY started_at DESC`,
            [pupilId, activityIds],
          )
          sessions = sessionsResult.rows
        }

        const sessionIds = sessions.map((r) => r.session_id)
        let attemptsBySession = new Map<string, {
          term: string
          definition: string
          chosen_definition: string
          is_correct: boolean
          attempt_number: number
          attempted_at: string
        }[]>()

        if (sessionIds.length > 0) {
          const attemptsResult = await query<{
            session_id: string
            term: string
            definition: string
            chosen_definition: string
            is_correct: boolean
            attempt_number: number
            attempted_at: string
          }>(
            `SELECT session_id, term, definition, chosen_definition, is_correct, attempt_number, attempted_at
             FROM flashcard_attempts
             WHERE session_id = ANY($1::text[])
             ORDER BY session_id, attempt_number, attempted_at`,
            [sessionIds],
          )

          for (const row of attemptsResult.rows) {
            const arr = attemptsBySession.get(row.session_id) ?? []
            arr.push(row)
            attemptsBySession.set(row.session_id, arr)
          }
        }

        const shapedSessions = sessions.map((s) => ({
          sessionId: s.session_id,
          activityTitle: activityTitleMap.get(s.activity_id) ?? "Flashcards",
          status: s.status,
          startedAt: s.started_at,
          completedAt: s.completed_at,
          totalCards: s.total_cards,
          correctCount: s.correct_count,
          attempts: (attemptsBySession.get(s.session_id) ?? []).map((a) => ({
            term: a.term,
            definition: a.definition,
            chosenDefinition: a.chosen_definition,
            isCorrect: a.is_correct,
            attemptNumber: a.attempt_number,
            attemptedAt: a.attempted_at,
          })),
        }))

        return { data: { pupilName, sessions: shapedSessions }, error: null }
      } catch (error) {
        console.error("[flashcard-monitor] Failed to load session detail", error)
        const message = error instanceof Error ? error.message : "Unable to load session detail."
        return { data: null, error: message }
      }
    },
  )
}

export async function readClassFlashcardActivityAction(
  groupId: string,
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/flashcard-monitor:class"

  return withTelemetry(
    {
      routeTag,
      functionName: "readClassFlashcardActivityAction",
      params: { groupId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      await requireTeacherProfile()

      try {
        const membersResult = await query<{
          user_id: string
          first_name: string | null
          last_name: string | null
        }>(
          `SELECT gm.user_id, p.first_name, p.last_name
           FROM group_membership gm
           JOIN profiles p ON p.user_id = gm.user_id
           WHERE gm.group_id = $1
           ORDER BY p.last_name, p.first_name`,
          [groupId],
        )

        const pupils = membersResult.rows.map((r) => ({
          pupilId: r.user_id,
          firstName: r.first_name ?? "",
          lastName: r.last_name ?? "",
        }))

        const pupilIds = membersResult.rows.map((r) => r.user_id)
        let sessions: {
          sessionId: string
          pupilId: string
          activityId: string
          activityTitle: string
          status: "in_progress" | "completed"
          totalCards: number
          consecutiveCorrect: number
          correctCount: number
          wrongCount: number
          startedAt: string
          completedAt: string | null
        }[] = []

        if (pupilIds.length > 0) {
          const sessionsResult = await query<{
            session_id: string
            pupil_id: string
            activity_id: string
            activity_title: string
            status: string
            total_cards: number
            started_at: string
            completed_at: string | null
            correct_count: number
            wrong_count: number
          }>(
            `SELECT
               fs.session_id,
               fs.pupil_id,
               fs.activity_id,
               coalesce(a.title, 'Flashcards') as activity_title,
               fs.status,
               fs.total_cards::integer,
               fs.started_at,
               fs.completed_at,
               coalesce(SUM(fa.is_correct::int), 0)::integer as correct_count,
               (COUNT(fa.attempt_id) - coalesce(SUM(fa.is_correct::int), 0))::integer as wrong_count
             FROM flashcard_sessions fs
             JOIN activities a ON a.activity_id = fs.activity_id
             LEFT JOIN flashcard_attempts fa ON fa.session_id = fs.session_id
             WHERE fs.pupil_id = ANY($1::text[])
               AND (
                 fs.status = 'in_progress'
                 OR (fs.status = 'completed' AND fs.completed_at > now() - interval '24 hours')
               )
             GROUP BY
               fs.session_id, fs.pupil_id, fs.activity_id, a.title,
               fs.status, fs.total_cards, fs.started_at, fs.completed_at
             ORDER BY fs.started_at DESC`,
            [pupilIds],
          )

          sessions = sessionsResult.rows.map((r) => ({
            sessionId: r.session_id,
            pupilId: r.pupil_id,
            activityId: r.activity_id,
            activityTitle: r.activity_title,
            status: r.status as "in_progress" | "completed",
            totalCards: r.total_cards,
            consecutiveCorrect: r.status === "completed" ? r.total_cards : 0,
            correctCount: r.correct_count,
            wrongCount: r.wrong_count,
            startedAt: r.started_at,
            completedAt: r.completed_at,
          }))
        }

        return { data: { pupils, sessions }, error: null }
      } catch (error) {
        console.error("[flashcard-monitor] Failed to load class activity", error)
        const message = error instanceof Error ? error.message : "Unable to load class activity."
        return { data: null, error: message }
      }
    },
  )
}

export async function readFlashcardMonitorGroupsAction(
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/flashcard-monitor:groups"

  return withTelemetry(
    {
      routeTag,
      functionName: "readFlashcardMonitorGroupsAction",
      params: {},
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      await requireTeacherProfile()

      try {
        const groupsResult = await query<{
          group_id: string
          subject: string | null
        }>(
          `SELECT group_id, subject FROM groups WHERE active = true ORDER BY subject, group_id`,
        )

        const groups = groupsResult.rows.map((g) => ({
          groupId: g.group_id,
          subject: g.subject ?? "",
        }))

        const groupIds = groups.map((g) => g.groupId)
        let groupUnits: { groupId: string; unitId: string; unitTitle: string }[] = []
        let groupActivities: { groupId: string; activityId: string; activityTitle: string }[] = []

        if (groupIds.length > 0) {
          const [unitsResult, activitiesResult] = await Promise.all([
            query<{ group_id: string; unit_id: string; unit_title: string }>(
              `SELECT DISTINCT la.group_id, u.unit_id, coalesce(u.title, 'Untitled') as unit_title
               FROM lesson_assignments la
               JOIN lessons l ON l.lesson_id = la.lesson_id
               JOIN units u ON u.unit_id = l.unit_id
               WHERE la.group_id = ANY($1::text[])
                 AND coalesce(l.active, true) = true
                 AND EXISTS (
                   SELECT 1 FROM activities a
                   WHERE a.lesson_id = l.lesson_id
                     AND a.type = 'display-flashcards'
                     AND coalesce(a.active, true) = true
                 )
               ORDER BY la.group_id, unit_title`,
              [groupIds],
            ),
            query<{ group_id: string; activity_id: string; activity_title: string }>(
              `SELECT la.group_id, a.activity_id, coalesce(a.title, 'Flashcards') as activity_title
               FROM lesson_assignments la
               JOIN lessons l ON l.lesson_id = la.lesson_id
               JOIN activities a ON a.lesson_id = l.lesson_id
               WHERE la.group_id = ANY($1::text[])
                 AND coalesce(l.active, true) = true
                 AND a.type = 'display-flashcards'
                 AND coalesce(a.active, true) = true
               ORDER BY la.group_id, activity_title`,
              [groupIds],
            ),
          ])

          groupUnits = unitsResult.rows.map((r) => ({
            groupId: r.group_id,
            unitId: r.unit_id,
            unitTitle: r.unit_title,
          }))

          groupActivities = activitiesResult.rows.map((r) => ({
            groupId: r.group_id,
            activityId: r.activity_id,
            activityTitle: r.activity_title,
          }))
        }

        return { data: { groups, groupUnits, groupActivities }, error: null }
      } catch (error) {
        console.error("[flashcard-monitor] Failed to load groups", error)
        const message = error instanceof Error ? error.message : "Unable to load groups."
        return { data: null, error: message }
      }
    },
  )
}
