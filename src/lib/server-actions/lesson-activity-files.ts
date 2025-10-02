"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createSupabaseServerClient } from "@/lib/supabase/server"

const LESSON_FILES_BUCKET = "lessons"

const ActivityFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  last_accessed_at: z.string().optional(),
  size: z.number().optional(),
})

const ActivityFilesReturnValue = z.object({
  data: z.array(ActivityFileSchema).nullable(),
  error: z.string().nullable(),
})

function buildDirectory(lessonId: string, activityId: string) {
  return `${lessonId}/activities/${activityId}`
}

function buildFilePath(lessonId: string, activityId: string, fileName: string) {
  return `${buildDirectory(lessonId, activityId)}/${fileName}`
}

function buildSubmissionDirectory(lessonId: string, activityId: string, pupilId: string) {
  return `${buildDirectory(lessonId, activityId)}/${pupilId}`
}

function buildSubmissionPath(lessonId: string, activityId: string, pupilId: string, fileName: string) {
  return `${buildSubmissionDirectory(lessonId, activityId, pupilId)}/${fileName}`
}

export async function listActivityFilesAction(lessonId: string, activityId: string) {
  const directory = buildDirectory(lessonId, activityId)
  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(LESSON_FILES_BUCKET)

  const { data, error } = await bucket.list(directory, { limit: 100 })

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

  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(LESSON_FILES_BUCKET)
  const fileName = file.name
  const fullPath = buildFilePath(lessonId, activityId, fileName)

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadError } = await bucket.upload(fullPath, arrayBuffer, {
    upsert: true,
    contentType: file.type || "application/octet-stream",
  })

  if (uploadError) {
    console.error("[v0] Failed to upload activity file:", uploadError)
    return { success: false, error: uploadError.message }
  }

  revalidatePath(`/units/${unitId}`)
  revalidatePath(`/lessons/${lessonId}`)
  return { success: true }
}

export async function deleteActivityFileAction(
  unitId: string,
  lessonId: string,
  activityId: string,
  fileName: string,
) {
  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(LESSON_FILES_BUCKET)
  const { error } = await bucket.remove([buildFilePath(lessonId, activityId, fileName)])

  if (error) {
    console.error("[v0] Failed to delete activity file:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/units/${unitId}`)
  revalidatePath(`/lessons/${lessonId}`)
  return { success: true }
}

export async function getActivityFileDownloadUrlAction(
  lessonId: string,
  activityId: string,
  fileName: string,
) {
  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(LESSON_FILES_BUCKET)
  const { data, error } = await bucket.createSignedUrl(
    buildFilePath(lessonId, activityId, fileName),
    60 * 10,
  )

  if (error) {
    console.error("[v0] Failed to create signed URL for activity file:", error)
    return { success: false, error: error.message }
  }

  return { success: true, url: data?.signedUrl ?? null }
}

export async function listPupilActivitySubmissionsAction(
  lessonId: string,
  activityId: string,
  pupilId: string,
) {
  const directory = buildSubmissionDirectory(lessonId, activityId, pupilId)
  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(LESSON_FILES_BUCKET)

  const { data, error } = await bucket.list(directory, { limit: 100 })

  if (error) {
    if (error.message?.toLowerCase().includes("not found")) {
      return ActivityFilesReturnValue.parse({ data: [], error: null })
    }
    console.error("[v0] Failed to list pupil submissions:", error)
    return ActivityFilesReturnValue.parse({ data: null, error: error.message })
  }

  const normalized = (data ?? [])
    .map((file) =>
      ActivityFileSchema.parse({
        name: file.name,
        path: buildSubmissionPath(lessonId, activityId, pupilId, file.name),
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

export async function uploadPupilActivitySubmissionAction(formData: FormData) {
  const lessonId = formData.get("lessonId")
  const activityId = formData.get("activityId")
  const pupilId = formData.get("pupilId")
  const file = formData.get("file")

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

  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(LESSON_FILES_BUCKET)

  const fileName = file.name
  const path = buildSubmissionPath(lessonId, activityId, pupilId, fileName)

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadError } = await bucket.upload(path, arrayBuffer, {
    upsert: true,
    contentType: file.type || "application/octet-stream",
  })

  if (uploadError) {
    console.error("[v0] Failed to upload pupil submission:", uploadError)
    return { success: false, error: uploadError.message }
  }

  revalidatePath(`/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${encodeURIComponent(lessonId)}`)
  return { success: true }
}

export async function deletePupilActivitySubmissionAction(
  lessonId: string,
  activityId: string,
  pupilId: string,
  fileName: string,
) {
  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(LESSON_FILES_BUCKET)
  const { error } = await bucket.remove([
    buildSubmissionPath(lessonId, activityId, pupilId, fileName),
  ])

  if (error) {
    console.error("[v0] Failed to delete pupil submission:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${encodeURIComponent(lessonId)}`)
  return { success: true }
}

export async function getPupilActivitySubmissionUrlAction(
  lessonId: string,
  activityId: string,
  pupilId: string,
  fileName: string,
) {
  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(LESSON_FILES_BUCKET)
  const { data, error } = await bucket.createSignedUrl(
    buildSubmissionPath(lessonId, activityId, pupilId, fileName),
    60 * 10,
  )

  if (error) {
    console.error("[v0] Failed to create signed URL for pupil submission:", error)
    return { success: false, error: error.message }
  }

  return { success: true, url: data?.signedUrl ?? null }
}
