"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { withTelemetry } from "@/lib/telemetry"
import { query } from "@/lib/db"

const LESSON_FILES_BUCKET = "lessons"

const LessonFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  last_accessed_at: z.string().optional(),
  size: z.number().optional(),
  deletable: z.boolean().default(true),
  file_url: z.string().optional(),
  activity_title: z.string().optional(),
})

const LessonFilesReturnValue = z.object({
  data: z.array(LessonFileSchema).nullable(),
  error: z.string().nullable(),
})

const LessonFileUploadResult = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
  files: z.array(LessonFileSchema).nullable().optional(),
})

function buildFilePath(lessonId: string, fileName: string) {
  return `${lessonId}/${fileName}`
}

export async function listLessonFilesAction(
  lessonId: string,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const routeTag = options?.routeTag ?? "/lessons:files"

  return withTelemetry(
    {
      routeTag,
      functionName: "listLessonFilesAction",
      params: { lessonId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
      const { data, error } = await storage.list(lessonId, { limit: 100 })

      if (error) {
        console.error("[v0] Failed to list lesson files:", error)
        return LessonFilesReturnValue.parse({ data: null, error: error.message })
      }

      const toIsoOrUndefined = (value: unknown) => {
        if (typeof value === "string") return value
        if (value instanceof Date) return value.toISOString()
        return undefined
      }

      // Teacher-uploaded lesson files (deletable)
      const lessonFiles = (data ?? []).map((file) =>
        LessonFileSchema.parse({
          name: file.name,
          path: buildFilePath(lessonId, file.name),
          created_at: toIsoOrUndefined(file.created_at),
          updated_at: toIsoOrUndefined(file.updated_at),
          last_accessed_at: toIsoOrUndefined(file.last_accessed_at),
          size: file.metadata?.size ?? undefined,
          deletable: true,
          file_url: `/api/files/${[LESSON_FILES_BUCKET, lessonId, file.name].map(encodeURIComponent).join("/")}`,
        }),
      )

      // Files attached to file-download activities (read-only in this panel)
      let activityFiles: z.infer<typeof LessonFileSchema>[] = []
      try {
        const { rows } = await query<{
          file_name: string
          scope_path: string
          created_at: string | null
          updated_at: string | null
          size_bytes: number | null
          activity_title: string | null
          activity_id: string
        }>(
          `
          select
            sf.file_name,
            sf.scope_path,
            sf.created_at,
            sf.updated_at,
            sf.size_bytes,
            a.title as activity_title,
            a.activity_id
          from stored_files sf
          join activities a
            on sf.scope_path = ($1 || '/activities/' || a.activity_id)
          where a.lesson_id = $1
            and a.type = 'file-download'
            and sf.bucket = $2
          order by sf.updated_at desc nulls last
          `,
          [lessonId, LESSON_FILES_BUCKET],
        )

        activityFiles = rows.map((row) =>
          LessonFileSchema.parse({
            name: row.file_name,
            path: `${row.scope_path}/${row.file_name}`,
            created_at: toIsoOrUndefined(row.created_at),
            updated_at: toIsoOrUndefined(row.updated_at),
            size: typeof row.size_bytes === "number" ? row.size_bytes : undefined,
            deletable: false,
            activity_title: row.activity_title ?? undefined,
            file_url: `/api/files/${[LESSON_FILES_BUCKET, lessonId, "activities", row.activity_id, row.file_name].map(encodeURIComponent).join("/")}`,
          }),
        )
      } catch (err) {
        console.warn("[lesson-files] Failed to load activity files:", err)
      }

      const allFiles = [...lessonFiles, ...activityFiles].sort((a, b) => {
        const aTime = Date.parse(a.updated_at ?? a.created_at ?? "0")
        const bTime = Date.parse(b.updated_at ?? b.created_at ?? "0")
        return bTime - aTime
      })

      return LessonFilesReturnValue.parse({ data: allFiles, error: null })
    },
  )
}

export async function uploadLessonFileAction(formData: FormData) {
  const lessonId = formData.get("lessonId")
  const unitId = formData.get("unitId")
  const file = formData.get("file")

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return { success: false, error: "Missing lesson identifier" }
  }

  if (typeof unitId !== "string" || unitId.trim() === "") {
    return { success: false, error: "Missing unit identifier" }
  }

  if (!(file instanceof File)) {
    return { success: false, error: "No file provided" }
  }

  if (file.size > 5 * 1024 * 1024) {
    return { success: false, error: "File exceeds 5MB limit" }
  }

  const fileName = file.name
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const fullPath = buildFilePath(lessonId, fileName)
  const arrayBuffer = await file.arrayBuffer()
  const { error } = await storage.upload(fullPath, arrayBuffer, {
    contentType: file.type || "application/octet-stream",
    originalPath: fullPath,
  })

  if (error) {
    console.error("[v0] Failed to upload lesson file:", error)
    return { success: false, error: error.message }
  }

  let latestFiles: Array<z.infer<typeof LessonFileSchema>> | null = null
  try {
    const { data: freshList, error: listError } = await storage.list(lessonId, { limit: 100 })
    if (!listError) {
      const toIsoOrUndefined = (value: unknown) => {
        if (typeof value === "string") return value
        if (value instanceof Date) return value.toISOString()
        return undefined
      }
      latestFiles =
        freshList?.map((item) =>
          LessonFileSchema.parse({
            name: item.name,
            path: buildFilePath(lessonId, item.name),
            created_at: toIsoOrUndefined(item.created_at),
            updated_at: toIsoOrUndefined(item.updated_at),
            last_accessed_at: toIsoOrUndefined(item.last_accessed_at),
            size: item.metadata?.size ?? undefined,
          }),
        ) ?? null
    }
  } catch (listError) {
    console.warn("[lessons] Unable to refresh lesson files after upload", listError)
  }

  return LessonFileUploadResult.parse({ success: true, error: null, files: latestFiles })
}

export async function deleteLessonFileAction(unitId: string, lessonId: string, fileName: string) {
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const { error } = await storage.remove([buildFilePath(lessonId, fileName)])

  if (error) {
    console.error("[v0] Failed to delete lesson file:", error)
    return { success: false, error: error.message }
  }

  let latestFiles: Array<z.infer<typeof LessonFileSchema>> | null = null
  try {
    const { data: freshList, error: listError } = await storage.list(lessonId, { limit: 100 })
    if (!listError) {
      const toIsoOrUndefined = (value: unknown) => {
        if (typeof value === "string") return value
        if (value instanceof Date) return value.toISOString()
        return undefined
      }
      latestFiles =
        freshList?.map((item) =>
          LessonFileSchema.parse({
            name: item.name,
            path: buildFilePath(lessonId, item.name),
            created_at: toIsoOrUndefined(item.created_at),
            updated_at: toIsoOrUndefined(item.updated_at),
            last_accessed_at: toIsoOrUndefined(item.last_accessed_at),
            size: item.metadata?.size ?? undefined,
          }),
        ) ?? null
    }
  } catch (listError) {
    console.warn("[lessons] Unable to refresh lesson files after deletion", listError)
  }

  return LessonFileUploadResult.parse({ success: true, error: null, files: latestFiles })
}

export async function getLessonFileDownloadUrlAction(lessonId: string, fileName: string) {
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const { data, error } = await storage.createSignedUrl(buildFilePath(lessonId, fileName))

  if (error) {
    console.error("[v0] Failed to create download URL for lesson file:", error)
    return { success: false, error: error.message }
  }

  return { success: true, url: data?.signedUrl ?? null }
}
