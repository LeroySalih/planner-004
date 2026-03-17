"use server"

import { performance } from "node:perf_hooks"
import { z } from "zod"
import { query } from "@/lib/db"
import { requireTeacherProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"

// ── Marking Queue ────────────────────────────────────────────────────────────

const MarkingQueueItemSchema = z.object({
  lessonId: z.string(),
  lessonTitle: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  unitTitle: z.string(),
  submissionCount: z.number(),
})

const MarkingQueueResultSchema = z.object({
  data: MarkingQueueItemSchema.array().nullable(),
  error: z.string().nullable(),
})

export type MarkingQueueItem = z.infer<typeof MarkingQueueItemSchema>

export async function readMarkingQueueAction() {
  await requireTeacherProfile()
  const authEndTime = performance.now()

  return withTelemetry(
    { routeTag: "dashboard", functionName: "readMarkingQueueAction", params: {}, authEndTime },
    async () => {
      try {
        const { rows } = await query<{
          lesson_id: string
          lesson_title: string
          group_id: string
          group_name: string
          unit_title: string
          submission_count: number
        }>(
          `
            SELECT
              l.lesson_id,
              l.title                        AS lesson_title,
              g.group_id,
              g.subject                      AS group_name,
              u.title                        AS unit_title,
              COUNT(DISTINCT s.submission_id)::int AS submission_count
            FROM submissions s
            JOIN activities          a  ON a.activity_id  = s.activity_id
            JOIN lessons             l  ON l.lesson_id    = a.lesson_id
            JOIN lesson_assignments  la ON la.lesson_id   = l.lesson_id
            JOIN groups              g  ON g.group_id     = la.group_id
            JOIN group_membership    gm ON gm.group_id    = g.group_id AND gm.user_id = s.user_id
            JOIN units               u  ON u.unit_id      = l.unit_id
            WHERE a.type = 'short-text-question'
              AND compute_submission_base_score(s.body, a.type) IS NULL
            GROUP BY l.lesson_id, l.title, g.group_id, g.subject, u.title
            ORDER BY COUNT(DISTINCT s.submission_id) DESC
          `,
        )

        const data = (rows ?? []).map((row) => ({
          lessonId: row.lesson_id,
          lessonTitle: row.lesson_title,
          groupId: row.group_id,
          groupName: row.group_name,
          unitTitle: row.unit_title,
          submissionCount: row.submission_count,
        }))

        return MarkingQueueResultSchema.parse({ data, error: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load marking queue."
        console.error("[dashboard] readMarkingQueueAction failed", error)
        return MarkingQueueResultSchema.parse({ data: null, error: message })
      }
    },
  )
}

// ── Flagged Submissions ──────────────────────────────────────────────────────

const FlaggedItemSchema = z.object({
  submissionId: z.string(),
  pupilName: z.string(),
  activityTitle: z.string(),
  lessonId: z.string(),
  lessonTitle: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  submittedAt: z.string().nullable(),
})

const FlaggedResultSchema = z.object({
  data: FlaggedItemSchema.array().nullable(),
  error: z.string().nullable(),
})

export type FlaggedItem = z.infer<typeof FlaggedItemSchema>

export async function readFlaggedSubmissionsAction() {
  await requireTeacherProfile()
  const authEndTime = performance.now()

  return withTelemetry(
    { routeTag: "dashboard", functionName: "readFlaggedSubmissionsAction", params: {}, authEndTime },
    async () => {
      try {
        const { rows } = await query<{
          submission_id: string
          pupil_name: string
          activity_title: string
          lesson_id: string
          lesson_title: string
          group_id: string
          group_name: string
          submitted_at: Date | null
        }>(
          `
            SELECT DISTINCT ON (s.submission_id)
              s.submission_id,
              TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))  AS pupil_name,
              a.title                                                                 AS activity_title,
              l.lesson_id,
              l.title                                                                 AS lesson_title,
              g.group_id,
              g.subject                                                               AS group_name,
              s.submitted_at
            FROM submissions         s
            JOIN profiles            p  ON p.user_id     = s.user_id
            JOIN activities          a  ON a.activity_id = s.activity_id
            JOIN lessons             l  ON l.lesson_id   = a.lesson_id
            JOIN lesson_assignments  la ON la.lesson_id  = l.lesson_id
            JOIN groups              g  ON g.group_id    = la.group_id
            WHERE s.is_flagged = true
            ORDER BY s.submission_id, s.submitted_at DESC NULLS LAST
          `,
        )

        const data = (rows ?? []).map((row) => ({
          submissionId: row.submission_id,
          pupilName: row.pupil_name,
          activityTitle: row.activity_title,
          lessonId: row.lesson_id,
          lessonTitle: row.lesson_title,
          groupId: row.group_id,
          groupName: row.group_name,
          submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
        }))

        return FlaggedResultSchema.parse({ data, error: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load flagged submissions."
        console.error("[dashboard] readFlaggedSubmissionsAction failed", error)
        return FlaggedResultSchema.parse({ data: null, error: message })
      }
    },
  )
}

// ── Mentions ─────────────────────────────────────────────────────────────────

const MentionItemSchema = z.object({
  commentId: z.string(),
  submissionId: z.string(),
  pupilName: z.string(),
  comment: z.string(),
  lessonId: z.string(),
  lessonTitle: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  createdAt: z.string(),
})

const MentionsResultSchema = z.object({
  data: MentionItemSchema.array().nullable(),
  error: z.string().nullable(),
})

export type MentionItem = z.infer<typeof MentionItemSchema>

export async function readMentionsAction() {
  await requireTeacherProfile()
  const authEndTime = performance.now()

  return withTelemetry(
    { routeTag: "dashboard", functionName: "readMentionsAction", params: {}, authEndTime },
    async () => {
      try {
        const { rows } = await query<{
          comment_id: string
          submission_id: string
          pupil_name: string
          comment: string
          lesson_id: string
          lesson_title: string
          group_id: string
          group_name: string
          created_at: Date
        }>(
          `
            SELECT
              sc.id                                                                    AS comment_id,
              sc.submission_id,
              TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))   AS pupil_name,
              sc.comment,
              l.lesson_id,
              l.title                                                                  AS lesson_title,
              la.group_id,
              g.subject                                                                AS group_name,
              sc.created_at
            FROM submission_comments  sc
            JOIN submissions          s   ON s.submission_id  = sc.submission_id
            JOIN profiles             p   ON p.user_id        = sc.user_id
            JOIN activities           a   ON a.activity_id    = s.activity_id
            JOIN lessons              l   ON l.lesson_id      = a.lesson_id
            JOIN LATERAL (
              SELECT group_id FROM lesson_assignments WHERE lesson_id = l.lesson_id LIMIT 1
            ) la ON true
            JOIN groups               g   ON g.group_id       = la.group_id
            ORDER BY sc.created_at DESC
          `,
        )

        const data = (rows ?? []).map((row) => ({
          commentId: row.comment_id,
          submissionId: row.submission_id,
          pupilName: row.pupil_name,
          comment: row.comment,
          lessonId: row.lesson_id,
          lessonTitle: row.lesson_title,
          groupId: row.group_id,
          groupName: row.group_name,
          createdAt: row.created_at.toISOString(),
        }))

        return MentionsResultSchema.parse({ data, error: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load mentions."
        console.error("[dashboard] readMentionsAction failed", error)
        return MentionsResultSchema.parse({ data: null, error: message })
      }
    },
  )
}

// ── Mark All Unmarked ─────────────────────────────────────────────────────────

const MarkAllUnmarkedInputSchema = z.object({
  groupId: z.string().min(1),
  lessonId: z.string().min(1),
})

const MarkAllUnmarkedResultSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  error: z.string().nullable(),
})

export async function markAllUnmarkedForLessonAction(input: z.infer<typeof MarkAllUnmarkedInputSchema>) {
  await requireTeacherProfile()
  const authEndTime = performance.now()

  return withTelemetry(
    { routeTag: "dashboard", functionName: "markAllUnmarkedForLessonAction", params: input, authEndTime },
    async () => {
      try {
        const { groupId, lessonId } = MarkAllUnmarkedInputSchema.parse(input)

        const { rows } = await query<{ submission_id: string }>(
          `
            SELECT DISTINCT s.submission_id
            FROM submissions s
            JOIN activities         a  ON a.activity_id = s.activity_id
            JOIN lessons            l  ON l.lesson_id   = a.lesson_id
            JOIN lesson_assignments la ON la.lesson_id  = l.lesson_id
                                      AND la.group_id   = $2
            JOIN group_membership   gm ON gm.group_id   = la.group_id
                                      AND gm.user_id    = s.user_id
            WHERE l.lesson_id = $1
              AND a.type = 'short-text-question'
              AND compute_submission_base_score(s.body, a.type) IS NULL
          `,
          [lessonId, groupId],
        )

        const submissions = (rows ?? []).map((r) => ({ submissionId: r.submission_id }))

        if (submissions.length === 0) {
          return MarkAllUnmarkedResultSchema.parse({ success: true, count: 0, error: null })
        }

        const assignmentId = `${groupId}__${lessonId}`
        await enqueueMarkingTasks(assignmentId, submissions)
        void triggerQueueProcessor()

        return MarkAllUnmarkedResultSchema.parse({ success: true, count: submissions.length, error: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to queue submissions for marking."
        console.error("[dashboard] markAllUnmarkedForLessonAction failed", error)
        return MarkAllUnmarkedResultSchema.parse({ success: false, count: 0, error: message })
      }
    },
  )
}
