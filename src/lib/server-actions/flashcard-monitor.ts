"use server"

import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"
import { requireTeacherProfile } from "@/lib/auth"

type TelemetryOptions = { authEndTime?: number | null; routeTag?: string }

export async function readLiveFlashcardMonitorAction(
  groupId: string,
  lessonId: string,
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/flashcard-monitor:live"

  return withTelemetry(
    {
      routeTag,
      functionName: "readLiveFlashcardMonitorAction",
      params: { groupId, lessonId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      await requireTeacherProfile()

      try {
        const [membersResult, lessonResult] = await Promise.all([
          query<{ user_id: string; first_name: string | null; last_name: string | null }>(
            `SELECT gm.user_id, p.first_name, p.last_name
             FROM group_membership gm
             JOIN profiles p ON p.user_id = gm.user_id
             WHERE gm.group_id = $1
             ORDER BY p.first_name, p.last_name`,
            [groupId],
          ),
          query<{ title: string }>(
            `SELECT coalesce(title, 'Untitled lesson') as title FROM lessons WHERE lesson_id = $1 LIMIT 1`,
            [lessonId],
          ),
        ])

        const pupilIds = membersResult.rows.map((r) => r.user_id)
        const lessonTitle = lessonResult.rows[0]?.title ?? "Untitled lesson"

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
             WHERE lesson_id = $1 AND pupil_id = ANY($2::text[])
             ORDER BY pupil_id, started_at DESC`,
            [lessonId, pupilIds],
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

        return { data: { pupils, lessonTitle }, error: null }
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
        const [lessonsResult, membersResult, unitResult] = await Promise.all([
          query<{ lesson_id: string; title: string; order_by: number | null }>(
            `SELECT l.lesson_id, coalesce(l.title, 'Untitled') as title, l.order_by
             FROM lessons l
             WHERE l.unit_id = $1
               AND coalesce(l.active, true) = true
               AND EXISTS (
                 SELECT 1 FROM activities a
                 WHERE a.lesson_id = l.lesson_id
                   AND a.type = 'display-key-terms'
                   AND coalesce(a.active, true) = true
               )
             ORDER BY l.order_by ASC NULLS LAST`,
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

        const lessonIds = lessonsResult.rows.map((r) => r.lesson_id)
        const pupilIds = membersResult.rows.map((r) => r.user_id)
        const unitTitle = unitResult.rows[0]?.title ?? "Untitled unit"

        let cells: { pupilId: string; lessonId: string; completedAt: string }[] = []

        if (lessonIds.length > 0 && pupilIds.length > 0) {
          const cellsResult = await query<{
            pupil_id: string
            lesson_id: string
            completed_at: string
          }>(
            `SELECT DISTINCT ON (pupil_id, lesson_id)
               pupil_id, lesson_id, completed_at
             FROM flashcard_sessions
             WHERE status = 'completed'
               AND lesson_id = ANY($1::text[])
               AND pupil_id = ANY($2::text[])
             ORDER BY pupil_id, lesson_id, completed_at DESC`,
            [lessonIds, pupilIds],
          )

          cells = cellsResult.rows.map((r) => ({
            pupilId: r.pupil_id,
            lessonId: r.lesson_id,
            completedAt: r.completed_at,
          }))
        }

        const lessons = lessonsResult.rows.map((r) => ({
          lessonId: r.lesson_id,
          title: r.title,
        }))

        const pupils = membersResult.rows.map((r) => ({
          pupilId: r.user_id,
          firstName: r.first_name ?? "",
          lastName: r.last_name ?? "",
        }))

        return { data: { lessons, pupils, cells, unitTitle }, error: null }
      } catch (error) {
        console.error("[flashcard-monitor] Failed to load study tracker", error)
        const message = error instanceof Error ? error.message : "Unable to load study tracker data."
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

        // For each group, find units that have lessons assigned to the group
        // and that contain key-terms activities
        const groupIds = groups.map((g) => g.groupId)
        let groupUnits: { groupId: string; unitId: string; unitTitle: string }[] = []
        let groupLessons: { groupId: string; lessonId: string; lessonTitle: string }[] = []

        if (groupIds.length > 0) {
          const [unitsResult, lessonsResult] = await Promise.all([
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
                     AND a.type = 'display-key-terms'
                     AND coalesce(a.active, true) = true
                 )
               ORDER BY la.group_id, unit_title`,
              [groupIds],
            ),
            query<{ group_id: string; lesson_id: string; lesson_title: string }>(
              `SELECT la.group_id, la.lesson_id, coalesce(l.title, 'Untitled') as lesson_title
               FROM lesson_assignments la
               JOIN lessons l ON l.lesson_id = la.lesson_id
               WHERE la.group_id = ANY($1::text[])
                 AND coalesce(l.active, true) = true
                 AND EXISTS (
                   SELECT 1 FROM activities a
                   WHERE a.lesson_id = l.lesson_id
                     AND a.type = 'display-key-terms'
                     AND coalesce(a.active, true) = true
                 )
               ORDER BY la.group_id, lesson_title`,
              [groupIds],
            ),
          ])

          groupUnits = unitsResult.rows.map((r) => ({
            groupId: r.group_id,
            unitId: r.unit_id,
            unitTitle: r.unit_title,
          }))

          groupLessons = lessonsResult.rows.map((r) => ({
            groupId: r.group_id,
            lessonId: r.lesson_id,
            lessonTitle: r.lesson_title,
          }))
        }

        return { data: { groups, groupUnits, groupLessons }, error: null }
      } catch (error) {
        console.error("[flashcard-monitor] Failed to load groups", error)
        const message = error instanceof Error ? error.message : "Unable to load groups."
        return { data: null, error: message }
      }
    },
  )
}
