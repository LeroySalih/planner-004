"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { Client } from "pg"

import {
  GroupsSchema,
  LessonsSchema,
  SubmissionStatusSchema,
  UnitsSchema,
  UploadSubmissionFilesSchema,
  type SubmissionStatus,
} from "@/types"
import { requireTeacherProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"
import { createSupabaseServiceClient } from "@/lib/supabase/server"

const QueueActivitySchema = z.object({
  activity_id: z.string(),
  lesson_id: z.string(),
  title: z.string().nullish().transform((value) => value ?? ""),
  type: z.string().nullish().transform((value) => value ?? ""),
})

const QueueActivitiesSchema = z.array(QueueActivitySchema)

const QueueFiltersSchema = z.object({
  groups: GroupsSchema.default([]),
  units: UnitsSchema.default([]),
  lessons: LessonsSchema.default([]),
  activities: QueueActivitiesSchema.default([]),
})

const QueueFiltersResultSchema = z.object({
  data: QueueFiltersSchema.nullable(),
  error: z.string().nullable(),
})

const QueueItemsResultSchema = z.object({
  data: UploadSubmissionFilesSchema.nullable(),
  error: z.string().nullable(),
})

const QueueAllItemsResultSchema = z.object({
  data: UploadSubmissionFilesSchema.nullable(),
  error: z.string().nullable(),
})

type QueueFiltersResult = z.infer<typeof QueueFiltersResultSchema>
type QueueItemsResult = z.infer<typeof QueueItemsResultSchema>
type QueueAllItemsResult = z.infer<typeof QueueAllItemsResultSchema>

function resolvePgConnectionString() {
  return process.env.POSTSQL_URL ?? process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? null
}

function createPgClient() {
  const connectionString = resolvePgConnectionString()
  if (!connectionString) {
    throw new Error("Database connection is not configured (POSTSQL_URL or SUPABASE_DB_URL missing).")
  }

  return new Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  })
}

function formatPupilName(firstName?: string | null, lastName?: string | null) {
  const first = (firstName ?? "").trim()
  const last = (lastName ?? "").trim()
  if (first && last) return `${first} ${last}`
  if (first) return first
  if (last) return last
  return null
}

export async function readQueueFiltersAction(input?: { unitId?: string | null; lessonId?: string | null }): Promise<QueueFiltersResult> {
  const routeTag = "/queue"

  return withTelemetry(
    { routeTag, functionName: "readQueueFiltersAction", params: input ?? {} },
    async () => {
      const client = createPgClient()

      try {
        await client.connect()

        const { rows: groupRows } = await client.query(
          "select group_id, coalesce(subject, 'General') as subject, coalesce(join_code, '') as join_code, coalesce(active, true) as active from groups where coalesce(active, true) = true order by subject, group_id",
        )
        const { rows: unitRows } = await client.query(
          "select unit_id, title, subject, active, description, year from units where coalesce(active, true) = true order by title asc",
        )

        const { rows: lessonRows } = await client.query(
          "select lesson_id, unit_id, title, order_by, active from lessons where coalesce(active, true) = true order by unit_id, order_by asc, title asc",
        )

        const { rows: activityRows } = await client.query(
          "select activity_id, lesson_id, title, type from activities where lower(type) like 'upload%' order by lesson_id, order_by asc nulls last, title asc",
        )

        return QueueFiltersResultSchema.parse({
          data: {
            groups: GroupsSchema.parse(groupRows ?? []),
            units: UnitsSchema.parse(unitRows ?? []),
            lessons: LessonsSchema.parse(lessonRows ?? []),
            activities: QueueActivitiesSchema.parse(activityRows ?? []),
          },
          error: null,
        })
      } catch (error) {
        console.error("[queue] Failed to load queue filters:", error)
        return QueueFiltersResultSchema.parse({
          data: null,
          error: "Unable to load queue filters.",
        })
      } finally {
        try {
          await client.end()
        } catch {
          // ignore close errors
        }
      }
    },
  )
}

export async function readQueueItemsAction(input: {
  groupId: string
  lessonId: string
  activityId: string
}): Promise<QueueItemsResult> {
  const routeTag = "/queue"
  const { groupId, lessonId, activityId } = input

  if (!groupId || !lessonId || !activityId) {
    return QueueItemsResultSchema.parse({
      data: null,
      error: "Missing selection for group, lesson, or activity.",
    })
  }

  return withTelemetry(
    { routeTag, functionName: "readQueueItemsAction", params: input },
    async () => {
      const client = createPgClient()

      try {
        await client.connect()

        const { rows: activityRows } = await client.query(
          "select lesson_id from activities where activity_id = $1 and lower(type) like 'upload%' limit 1",
          [activityId],
        )

        const activityRow = activityRows[0]
        if (!activityRow) {
          return QueueItemsResultSchema.parse({
            data: null,
            error: "Upload activity not found.",
          })
        }

        if (activityRow.lesson_id !== lessonId) {
          return QueueItemsResultSchema.parse({
            data: null,
            error: "Activity does not belong to the selected lesson.",
          })
        }

        const { rows: members } = await client.query(
          `
            select gm.user_id, gm.role, p.first_name, p.last_name
            from group_membership gm
            left join profiles p on p.user_id = gm.user_id
            where gm.group_id = $1 and coalesce(gm.role, '') <> 'teacher'
            order by coalesce(p.last_name, ''), coalesce(p.first_name, ''), gm.user_id
          `,
          [groupId],
        )

        const pupilIds = members.map((member) => member.user_id)

        let submissions: Array<{
          submission_id: string
          user_id: string
          submission_status: SubmissionStatus
          submitted_at: string | Date | null
          file_name: string
        }> = []

        if (pupilIds.length > 0) {
          const { rows } = await client.query(
            `
              select distinct on (user_id)
                submission_id,
                user_id,
                submission_status,
                submitted_at,
                coalesce(body->>'upload_file_name', '') as file_name
              from submissions
              where activity_id = $1 and user_id = any($2::text[])
              order by user_id, submitted_at desc
            `,
            [activityId, pupilIds],
          )
          submissions = rows ?? []
        }

        const submissionByUser = new Map(
          submissions.map((row) => [
            row.user_id,
            {
              ...row,
              submission_status: SubmissionStatusSchema.parse(row.submission_status),
              submitted_at:
                typeof row.submitted_at === "string"
                  ? row.submitted_at
                  : row.submitted_at instanceof Date
                    ? row.submitted_at.toISOString()
                    : null,
            },
          ]),
        )

        const queueItems = members.map((member) => {
          const submission = submissionByUser.get(member.user_id)
          const status = submission?.submission_status ?? "inprogress"
          const fileName = submission?.file_name || null

          return {
            submissionId: submission?.submission_id ?? null,
            pupilId: member.user_id,
            groupId,
            lessonId,
            activityId,
            pupilName: formatPupilName(member.first_name, member.last_name),
            fileName,
            filePath: fileName
              ? `lessons/${lessonId}/activities/${activityId}/${member.user_id}/${fileName}`
              : null,
            status,
            submittedAt: submission?.submitted_at ?? null,
          }
        })

        return QueueItemsResultSchema.parse({
          data: UploadSubmissionFilesSchema.parse(queueItems),
          error: null,
        })
      } catch (error) {
        console.error("[queue] Failed to load queue items:", error)
        return QueueItemsResultSchema.parse({
          data: null,
          error: "Unable to load queue items.",
        })
      } finally {
        try {
          await client.end()
        } catch {
          // ignore close errors
        }
      }
    },
  )
}

export async function readQueueAllItemsAction(): Promise<QueueAllItemsResult> {
  const routeTag = "/queue"

  return withTelemetry(
    { routeTag, functionName: "readQueueAllItemsAction" },
    async () => {
      const client = createPgClient()
      try {
        await client.connect()

        const { rows } = await client.query(
          `
            select
              s.submission_id,
              s.user_id,
              s.submission_status,
              s.submitted_at,
              coalesce(s.body->>'upload_file_name', '') as file_name,
              a.activity_id,
              a.title as activity_title,
              l.lesson_id,
              l.title as lesson_title,
              u.title as unit_title,
              gm.group_id,
              g.subject as group_subject
            from submissions s
            join activities a on a.activity_id = s.activity_id and lower(a.type) like 'upload%'
            left join lessons l on l.lesson_id = a.lesson_id
            left join units u on u.unit_id = l.unit_id
            left join group_membership gm on gm.user_id = s.user_id
            left join groups g on g.group_id = gm.group_id
            where coalesce(s.body->>'upload_file_name', '') <> ''
            order by s.submitted_at desc nulls last
          `,
        )

        const pupilIds = rows.map((row) => row.user_id)
        let profileMap = new Map<string, { first_name?: string | null; last_name?: string | null }>()

        if (pupilIds.length > 0) {
          const { rows: profileRows } = await client.query(
            "select user_id, first_name, last_name from profiles where user_id = any($1::text[])",
            [pupilIds],
          )
          profileMap = new Map(profileRows.map((row) => [row.user_id, row]))
        }

        const queueItems = rows.map((row) => {
          const profile = profileMap.get(row.user_id) ?? {}
          const status = SubmissionStatusSchema.safeParse(row.submission_status)
          const submittedAt =
            typeof row.submitted_at === "string"
              ? row.submitted_at
              : row.submitted_at instanceof Date
                ? row.submitted_at.toISOString()
                : null

          return {
            submissionId: row.submission_id ?? null,
            pupilId: row.user_id,
            activityId: row.activity_id,
            lessonId: row.lesson_id ?? null,
            groupId: row.group_id ?? null,
            pupilName: formatPupilName(profile.first_name, profile.last_name),
            fileName: row.file_name || null,
            filePath:
              row.file_name && row.lesson_id && row.activity_id
                ? `lessons/${row.lesson_id}/activities/${row.activity_id}/${row.user_id}/${row.file_name}`
                : null,
            status: status.success ? status.data : "inprogress",
            submittedAt,
            lessonTitle: row.lesson_title ?? null,
            unitTitle: row.unit_title ?? null,
            activityTitle: row.activity_title ?? null,
            groupName: row.group_subject ?? row.group_id ?? null,
          }
        })

        return QueueAllItemsResultSchema.parse({ data: UploadSubmissionFilesSchema.parse(queueItems), error: null })
      } catch (error) {
        console.error("[queue] Failed to load all queue items:", error)
        return QueueAllItemsResultSchema.parse({
          data: null,
          error: "Unable to load queue items.",
        })
      } finally {
        try {
          await client.end()
        } catch {
          // ignore close errors
        }
      }
    },
  )
}

export async function getQueueFileDownloadUrlAction(input: {
  lessonId: string
  activityId: string
  pupilId: string
  fileName: string
}) {
  const { lessonId, activityId, pupilId, fileName } = input
  if (!lessonId || !activityId || !pupilId || !fileName) {
    return { success: false, error: "Missing file details." }
  }

  const routeTag = "/queue"

  return withTelemetry(
    { routeTag, functionName: "getQueueFileDownloadUrlAction", params: { lessonId, activityId, pupilId } },
    async () => {
      const profile = await requireTeacherProfile()
      if (!profile) {
        return { success: false, error: "You need to sign in as a teacher." }
      }

      try {
        const supabase = await createSupabaseServiceClient()
        const bucket = supabase.storage.from("lessons")
        const path = `lessons/${lessonId}/activities/${activityId}/${pupilId}/${fileName}`
        const legacyPath = `${lessonId}/activities/${activityId}/${pupilId}/${fileName}`

        const candidates = [path, legacyPath].filter((value, index, array) => array.indexOf(value) === index)
        let lastError: { message?: string } | null = null

        for (const candidate of candidates) {
          const { data, error } = await bucket.createSignedUrl(candidate, 60 * 10)
          if (!error && data?.signedUrl) {
            return { success: true, url: data.signedUrl }
          }

          if (error) {
            const normalized = error.message?.toLowerCase() ?? ""
            if (normalized.includes("not found") || normalized.includes("object not found")) {
              lastError = error
              continue
            }
            return { success: false, error: error.message }
          }
        }

        return { success: false, error: lastError?.message ?? "File not found." }
      } catch (error) {
        console.error("[queue] Failed to create signed URL for file", error)
        return { success: false, error: "Unable to download file right now." }
      }
    },
  )
}

export async function updateUploadSubmissionStatusAction(input: {
  lessonId: string
  activityId: string
  pupilId: string
  status: SubmissionStatus
}) {
  const { lessonId, activityId, pupilId } = input
  if (!lessonId || !activityId || !pupilId) {
    return { success: false, error: "Missing selection for update." }
  }
  const statusParse = SubmissionStatusSchema.safeParse(input.status)
  if (!statusParse.success) {
    return { success: false, error: "Invalid status." }
  }

  const routeTag = "/queue"
  const targetStatus = statusParse.data

  return withTelemetry(
    { routeTag, functionName: "updateUploadSubmissionStatusAction", params: { lessonId, activityId, pupilId, status: targetStatus } },
    async () => {
      const profile = await requireTeacherProfile()
      if (!profile) {
        return { success: false, error: "You need to sign in as a teacher." }
      }

      const client = createPgClient()

      try {
        await client.connect()

        const { rows: activityRows } = await client.query(
          "select lesson_id from activities where activity_id = $1 and lower(type) like 'upload%' limit 1",
          [activityId],
        )
        const activityRow = activityRows[0]

        if (!activityRow) {
          return { success: false, error: "Upload activity not found." }
        }

        if (activityRow.lesson_id !== lessonId) {
          return { success: false, error: "Activity does not belong to the selected lesson." }
        }

        const { rows } = await client.query(
          `
            with target as (
              select submission_id
              from submissions
              where activity_id = $2 and user_id = $3
              order by submitted_at desc
              limit 1
            )
            update submissions s
            set submission_status = $1
            from target t
            where s.submission_id = t.submission_id
            returning s.submission_id
          `,
          [targetStatus, activityId, pupilId],
        )

        if (rows.length === 0) {
          return { success: false, error: "No submission found to update." }
        }

        revalidatePath("/queue")
        return { success: true }
      } catch (error) {
        console.error("[queue] Failed to update submission status:", error)
        return { success: false, error: "Unable to update status right now." }
      } finally {
        try {
          await client.end()
        } catch {
          // ignore close errors
        }
      }
    },
  )
}
