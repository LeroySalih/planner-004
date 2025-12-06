"use server"

import { performance } from "node:perf_hooks"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { Client } from "pg"

import { SubmissionStatusSchema } from "@/types"
import { query } from "@/lib/db"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { emitSubmissionEvent, emitUploadEvent } from "@/lib/sse/topics"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { withTelemetry } from "@/lib/telemetry"

const LESSON_FILES_BUCKET = "lessons"

const ActivityFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  last_accessed_at: z.string().optional(),
  size: z.number().optional(),
  submission_id: z.string().nullable().optional(),
  status: SubmissionStatusSchema.default("inprogress"),
  submitted_at: z.string().nullable().optional(),
})

const ActivityFilesReturnValue = z.object({
  data: z.array(ActivityFileSchema).nullable(),
  error: z.string().nullable(),
})

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

function buildDirectory(lessonId: string, activityId: string) {
  return `lessons/${lessonId}/activities/${activityId}`
}

function buildLegacyDirectory(lessonId: string, activityId: string) {
  return `${lessonId}/activities/${activityId}`
}

function buildFilePath(lessonId: string, activityId: string, fileName: string) {
  return `${buildDirectory(lessonId, activityId)}/${fileName}`
}

function buildSubmissionDirectory(lessonId: string, activityId: string, pupilId: string) {
  return `${buildDirectory(lessonId, activityId)}/${pupilId}`
}

function buildLegacySubmissionDirectory(lessonId: string, activityId: string, pupilId: string) {
  return `${buildLegacyDirectory(lessonId, activityId)}/${pupilId}`
}

function buildSubmissionPath(lessonId: string, activityId: string, pupilId: string, fileName: string) {
  return `${buildSubmissionDirectory(lessonId, activityId, pupilId)}/${fileName}`
}

function buildLegacySubmissionPath(lessonId: string, activityId: string, pupilId: string, fileName: string) {
  return `${buildLegacySubmissionDirectory(lessonId, activityId, pupilId)}/${fileName}`
}

function isStorageNotFoundError(error: { message?: string } | null): boolean {
  if (!error?.message) {
    return false
  }
  const normalized = error.message.toLowerCase()
  return normalized.includes("not found") || normalized.includes("object not found")
}

const pupilStorageKeyCache = new Map<string, string>()

function normaliseTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  return undefined
}

async function resolvePupilStorageKey(pupilId: string) {
  if (pupilStorageKeyCache.has(pupilId)) {
    return pupilStorageKeyCache.get(pupilId) as string
  }

  try {
    const { rows } = await query<{ email: string | null }>(
      `
        select email
        from profiles
        where user_id = $1
        limit 1
      `,
      [pupilId],
    )

    const email = rows?.[0]?.email?.trim()
    const resolved = email && email.length > 0 ? email : pupilId
    pupilStorageKeyCache.set(pupilId, resolved)
    return resolved
  } catch (error) {
    console.error("[lesson-activity-files] Failed to resolve pupil email for storage path", error, { pupilId })
    pupilStorageKeyCache.set(pupilId, pupilId)
    return pupilId
  }
}

export async function listActivityFilesAction(lessonId: string, activityId: string) {
  const directory = buildDirectory(lessonId, activityId)
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)

  const { data, error } = await storage.list(directory, { limit: 100 })

  if (error) {
    if (error.message?.toLowerCase().includes("not found")) {
      return ActivityFilesReturnValue.parse({ data: [], error: null })
    }
    console.error("[v0] Failed to list activity files:", error)
    return ActivityFilesReturnValue.parse({ data: null, error: error.message })
  }

  const normalized = (data ?? [])
    .map((file) =>
      ActivityFileSchema.parse({
        name: file.name,
        path: buildFilePath(lessonId, activityId, file.name),
        created_at: file.created_at ?? undefined,
        updated_at: file.updated_at ?? undefined,
        last_accessed_at: file.last_accessed_at ?? undefined,
        size: file.metadata?.size ?? undefined,
      }),
    )
    .sort((a, b) => {
      const aTime = Date.parse(a.updated_at ?? a.created_at ?? "0")
      const bTime = Date.parse(b.updated_at ?? b.created_at ?? "0")
      return bTime - aTime
    })

  return ActivityFilesReturnValue.parse({ data: normalized, error: null })
}

export async function uploadActivityFileAction(formData: FormData) {
  const authStart = performance.now()
  const profile = await requireAuthenticatedProfile({ refreshSessionCookie: true })
  const authEnd = performance.now()

  const unitId = formData.get("unitId")
  const lessonId = formData.get("lessonId")
  const activityId = formData.get("activityId")
  const file = formData.get("file")

  if (typeof unitId !== "string" || unitId.trim() === "") {
    return { success: false, error: "Missing unit identifier" }
  }

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return { success: false, error: "Missing lesson identifier" }
  }

  if (typeof activityId !== "string" || activityId.trim() === "") {
    return { success: false, error: "Missing activity identifier" }
  }

  if (!(file instanceof File)) {
    return { success: false, error: "No file provided" }
  }

  if (file.size > 5 * 1024 * 1024) {
    return { success: false, error: "File exceeds 5MB limit" }
  }

  return withTelemetry(
    {
      routeTag: "/lessons:activity-files",
      functionName: "uploadActivityFileAction",
      params: { unitId, lessonId, activityId, fileName: file.name },
      authEndTime: authEnd,
    },
    async () => {
      const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
      const fileName = file.name
      const fullPath = buildFilePath(lessonId, activityId, fileName)

      const arrayBuffer = await file.arrayBuffer()
      const { error } = await storage.upload(fullPath, arrayBuffer, {
        contentType: file.type || "application/octet-stream",
        uploadedBy: profile.userId,
        originalPath: fullPath,
      })

      if (error) {
        console.error("[v0] Failed to upload activity file:", error)
        return { success: false, error: error.message }
      }

      await emitUploadEvent("upload.activity.file_added", {
        unitId,
        lessonId,
        activityId,
        fileName,
        submittedBy: profile.userId,
      })

      revalidatePath(`/units/${unitId}`)
      return { success: true }
    },
  )
}

export async function deleteActivityFileAction(
  unitId: string,
  lessonId: string,
  activityId: string,
  fileName: string,
) {
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const { error } = await storage.remove([buildFilePath(lessonId, activityId, fileName)])

  if (error) {
    console.error("[v0] Failed to delete activity file:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}

export async function getActivityFileDownloadUrlAction(
  lessonId: string,
  activityId: string,
  fileName: string,
) {
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const { data, error } = await storage.createSignedUrl(buildFilePath(lessonId, activityId, fileName))

  if (error) {
    const message = error.message ?? ""
    const normalized = message.toLowerCase()
    if (normalized.includes("not found") || normalized.includes("object not found")) {
      return { success: false, error: "NOT_FOUND" }
    }
    console.error("[v0] Failed to create download URL for activity file:", error)
    return { success: false, error: message }
  }

  return { success: true, url: data?.signedUrl ?? null }
}

export async function listPupilActivitySubmissionsAction(
  lessonId: string,
  activityId: string,
  pupilId: string,
) {
  const routeTag = "/pupil-lessons"

  return withTelemetry(
    { routeTag, functionName: "listPupilActivitySubmissionsAction", params: { lessonId, activityId, pupilId } },
    async () => {
      const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
      const client = createPgClient()

      try {
        await client.connect()

        const { rows } = await client.query(
          `
            select submission_id, submission_status, submitted_at, coalesce(body->>'upload_file_name', '') as file_name
            from submissions
            where activity_id = $1 and user_id = $2
            order by submitted_at desc
            limit 1
          `,
          [activityId, pupilId],
        )

        const row = rows[0]
        const fileName = row?.file_name ?? ""
        const statusParse = SubmissionStatusSchema.safeParse(row?.submission_status)
        const status = statusParse.success ? statusParse.data : "inprogress"
        const submittedAt =
          typeof row?.submitted_at === "string"
            ? row.submitted_at
            : row?.submitted_at instanceof Date
              ? row.submitted_at.toISOString()
              : null

        if (!row || !fileName) {
          return ActivityFilesReturnValue.parse({ data: [], error: null })
        }

        const pupilStorageKey = await resolvePupilStorageKey(pupilId)
        const directories = [
          buildSubmissionDirectory(lessonId, activityId, pupilStorageKey),
          buildLegacySubmissionDirectory(lessonId, activityId, pupilStorageKey),
        ].filter((value, index, array) => array.indexOf(value) === index)

        let matchedPath: string | null = null
        let metadata: { created_at?: string; updated_at?: string; last_accessed_at?: string; size?: number } = {}
        let lastError: { message?: string } | null = null

        for (const directory of directories) {
          const { data, error } = await storage.list(directory, { limit: 100 })

          if (error) {
            if (isStorageNotFoundError(error)) {
              lastError = error
              continue
            }
            console.error("[v0] Failed to list pupil submissions:", error)
            return ActivityFilesReturnValue.parse({ data: null, error: error.message })
          }

          const match = (data ?? []).find((file) => file.name === fileName)
          if (match) {
            matchedPath = `${directory}/${match.name}`
            metadata = {
              created_at: normaliseTimestamp(match.created_at),
              updated_at: normaliseTimestamp(match.updated_at),
              last_accessed_at: normaliseTimestamp(match.last_accessed_at),
              size: match.metadata?.size ?? undefined,
            }
            break
          }
        }

        const resolvedPath = matchedPath ?? buildSubmissionPath(lessonId, activityId, pupilStorageKey, fileName)

        if (!matchedPath && lastError && isStorageNotFoundError(lastError)) {
          return ActivityFilesReturnValue.parse({
            data: [],
            error: "Uploaded file could not be found. Please upload again.",
          })
        }

        return ActivityFilesReturnValue.parse({
          data: [
            ActivityFileSchema.parse({
              name: fileName,
              path: resolvedPath,
              ...metadata,
              submission_id: row?.submission_id ?? null,
              status,
              submitted_at: submittedAt,
            }),
          ],
          error: null,
        })
      } catch (error) {
        console.error("[v0] Unexpected error listing pupil submissions:", error)
        return ActivityFilesReturnValue.parse({
          data: null,
          error: "Unable to load pupil submissions.",
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

export async function uploadPupilActivitySubmissionAction(formData: FormData) {
  const lessonId = formData.get("lessonId")
  const activityId = formData.get("activityId")
  const pupilId = formData.get("pupilId")
  const file = formData.get("file")

  const routeTag = "/pupil-lessons"

  return withTelemetry(
    { routeTag, functionName: "uploadPupilActivitySubmissionAction", params: { lessonId, activityId, pupilId } },
    async () => {
      if (typeof lessonId !== "string" || lessonId.trim() === "") {
        return { success: false, error: "Missing lesson identifier" }
      }

      if (typeof activityId !== "string" || activityId.trim() === "") {
        return { success: false, error: "Missing activity identifier" }
      }

      if (typeof pupilId !== "string" || pupilId.trim() === "") {
        return { success: false, error: "Missing pupil identifier" }
      }

      if (!(file instanceof File)) {
        return { success: false, error: "No file provided" }
      }

      if (file.size > 5 * 1024 * 1024) {
        return { success: false, error: "File exceeds 5MB limit" }
      }

      const profile = await requireAuthenticatedProfile()

      if (profile.userId !== pupilId) {
        return { success: false, error: "You can only upload files for your own account." }
      }

      const userId = profile.userId
      const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
      const pupilStorageKey = profile.email?.trim() ?? (await resolvePupilStorageKey(userId))

      const fileName = file.name
      const path = buildSubmissionPath(lessonId, activityId, pupilStorageKey, fileName)

      const arrayBuffer = await file.arrayBuffer()
      const { error: uploadError } = await storage.upload(path, arrayBuffer, {
        contentType: file.type || "application/octet-stream",
        uploadedBy: userId,
        originalPath: path,
      })

      if (uploadError) {
        console.error("[v0] Failed to upload pupil submission:", uploadError)
        return { success: false, error: uploadError.message }
      }

      const submittedAt = new Date().toISOString()
      let submissionId: string | null = null
      const client = createPgClient()

      try {
        await client.connect()

        try {
          const submissionResult = await upsertUploadSubmissionRecord({
            client,
            activityId,
            pupilId: userId,
            fileName,
            submittedAt,
          })

          if (!submissionResult.success) {
            await storage.remove([path])
            return { success: false, error: "Unable to record submission." }
          }
          submissionId = submissionResult.submissionId ?? null
        } catch (error) {
          console.error("[v0] Failed to upsert upload submission record:", error)
          await storage.remove([path])
          return { success: false, error: "Unable to record submission." }
        }
      } finally {
        try {
          await client.end()
        } catch {
          // ignore close errors
        }
      }

      console.log("[realtime-debug] Upload submission stored", {
        activityId,
        pupilId: userId,
        lessonId,
        fileName,
        submittedAt,
      })

      await emitSubmissionEvent("submission.uploaded", {
        submissionId,
        activityId,
        pupilId: userId,
        submittedAt,
        fileName,
        submissionStatus: "inprogress",
      })

      deferRevalidate(`/pupil-lessons/${encodeURIComponent(userId)}/lessons/${encodeURIComponent(lessonId)}`)
      return { success: true }
    },
  )
}

export async function deletePupilActivitySubmissionAction(
  lessonId: string,
  activityId: string,
  pupilId: string,
  fileName: string,
) {
  const routeTag = "/pupil-lessons"

  return withTelemetry(
    { routeTag, functionName: "deletePupilActivitySubmissionAction", params: { lessonId, activityId, pupilId } },
    async () => {
      const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
      const pupilStorageKey = await resolvePupilStorageKey(pupilId)
      const paths = [
        buildSubmissionPath(lessonId, activityId, pupilStorageKey, fileName),
        buildLegacySubmissionPath(lessonId, activityId, pupilStorageKey, fileName),
      ].filter((value, index, array) => array.indexOf(value) === index)

      let deleted = false
      let lastError: { message?: string } | null = null

      for (const path of paths) {
        const { error } = await storage.remove([path])
        if (!error) {
          deleted = true
          continue
        }

        if (isStorageNotFoundError(error)) {
          continue
        }

        lastError = error
        console.error("[v0] Failed to delete pupil submission:", error, { path })
        break
      }

      if (!deleted && lastError) {
        return { success: false, error: lastError.message }
      }

      const client = createPgClient()
      let submissionId: string | null = null
      try {
        await client.connect()
        const cleanupResult = await cleanupUploadSubmissionRecord({ client, activityId, pupilId })
        submissionId = cleanupResult.submissionId ?? null
        if (!cleanupResult.success) {
          return { success: false, error: "Unable to update submission." }
        }
      } finally {
        try {
          await client.end()
        } catch {
          // ignore close errors
        }
      }

      await emitSubmissionEvent("submission.deleted", {
        submissionId,
        activityId,
        pupilId,
        fileName,
        submittedAt: new Date().toISOString(),
        submissionStatus: "missing",
      })

      deferRevalidate(`/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${encodeURIComponent(lessonId)}`)
      return { success: true }
    },
  )
}

export async function getPupilActivitySubmissionUrlAction(
  lessonId: string,
  activityId: string,
  pupilId: string,
  fileName: string,
) {
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const pupilStorageKey = await resolvePupilStorageKey(pupilId)
  const paths = [
    buildSubmissionPath(lessonId, activityId, pupilStorageKey, fileName),
    buildLegacySubmissionPath(lessonId, activityId, pupilStorageKey, fileName),
  ].filter((value, index, array) => array.indexOf(value) === index)

  let lastError: { message?: string } | null = null

  for (const path of paths) {
    const { data, error } = await storage.createSignedUrl(path)
    if (!error) {
      return { success: true, url: data?.signedUrl ?? null }
    }

    if (isStorageNotFoundError(error)) {
      lastError = error
      continue
    }

    console.error("[v0] Failed to create signed URL for pupil submission:", error, { path })
    return { success: false, error: error.message }
  }

  return { success: false, error: lastError?.message ?? "NOT_FOUND" }
}

export async function updatePupilSubmissionStatusAction(input: {
  lessonId: string
  activityId: string
  pupilId: string
  status: z.infer<typeof SubmissionStatusSchema>
}) {
  const { lessonId, activityId, pupilId, status } = input
  const routeTag = "/pupil-lessons"

  const parsedStatus = SubmissionStatusSchema.safeParse(status)
  if (!parsedStatus.success) {
    return { success: false, error: "Invalid status." }
  }

  const normalizedStatus = parsedStatus.data
  if (normalizedStatus === "completed" || normalizedStatus === "rejected") {
    return { success: false, error: "Only teachers can mark uploads as completed or rejected." }
  }

  return withTelemetry(
    { routeTag, functionName: "updatePupilSubmissionStatusAction", params: { lessonId, activityId, pupilId, status } },
    async () => {
      const profile = await requireAuthenticatedProfile()

      if (profile.userId !== pupilId) {
        return { success: false, error: "You can only update your own submission status." }
      }

      const client = createPgClient()
      try {
        await client.connect()

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
            set submission_status = $1, submitted_at = case when $1 = 'submitted' then now() else s.submitted_at end
            from target t
            where s.submission_id = t.submission_id
            returning s.submission_id
          `,
          [normalizedStatus, activityId, profile.userId],
        )

        if (rows.length === 0) {
          return { success: false, error: "No submission to update yet." }
        }

        revalidatePath(
          `/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${encodeURIComponent(lessonId)}`,
        )
        return { success: true }
      } catch (error) {
        console.error("[pupil-lessons] Failed to update submission status:", error)
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

type UploadSubmissionSyncParams = {
  client: Client
  activityId: string
  pupilId: string
  fileName: string
  submittedAt: string
}

async function upsertUploadSubmissionRecord({
  client,
  activityId,
  pupilId,
  fileName,
  submittedAt,
}: UploadSubmissionSyncParams) {
  const payload = {
    submission_type: "upload-file",
    upload_submission: true,
    upload_file_name: fileName,
    upload_updated_at: submittedAt,
    success_criteria_scores: {},
  }

  const { rows: existingRows } = await client.query(
    `
      select submission_id
      from submissions
      where activity_id = $1 and user_id = $2
      order by submitted_at desc
      limit 1
    `,
    [activityId, pupilId],
  )

  const existing = existingRows[0] ?? null

  if (existing?.submission_id) {
    await client.query(
      `
        update submissions
        set body = $1, submitted_at = $2, submission_status = 'inprogress'
        where submission_id = $3
      `,
      [payload, submittedAt, existing.submission_id],
    )
    return { success: true, submissionId: existing.submission_id }
  }

  const { rows } = await client.query(
    `
      insert into submissions (activity_id, user_id, body, submitted_at, submission_status)
      values ($1, $2, $3, $4, 'inprogress')
      returning submission_id
    `,
    [activityId, pupilId, payload, submittedAt],
  )

  return { success: true, submissionId: rows[0]?.submission_id ?? null }
}

type UploadSubmissionCleanupParams = {
  client: Client
  activityId: string
  pupilId: string
}

async function cleanupUploadSubmissionRecord({
  client,
  activityId,
  pupilId,
}: UploadSubmissionCleanupParams) {
  const { rows } = await client.query(
    `
      select submission_id, body
      from submissions
      where activity_id = $1 and user_id = $2
      order by submitted_at desc
      limit 1
    `,
    [activityId, pupilId],
  )

  const data = rows[0]

  if (!data) {
    return { success: true, submissionId: null }
  }

  const record =
    data.body && typeof data.body === "object" ? { ...(data.body as Record<string, unknown>) } : {}
  const hasOverride =
    typeof record.teacher_override_score === "number" && Number.isFinite(record.teacher_override_score)

  if (hasOverride) {
    await client.query(
      `
        update submissions
        set body = $1, submission_status = 'inprogress'
        where submission_id = $2
      `,
      [
        {
          ...record,
          upload_submission: false,
          upload_file_name: null,
          upload_updated_at: null,
        },
        data.submission_id,
      ],
    )
    return { success: true, submissionId: data.submission_id ?? null }
  }

  await client.query("delete from submissions where submission_id = $1", [data.submission_id])

  return { success: true, submissionId: data.submission_id ?? null }
}
const deferRevalidate = (path: string) => {
  if (path.includes("/lessons/")) {
    return
  }
  queueMicrotask(() => revalidatePath(path))
}
