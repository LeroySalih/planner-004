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
    const message = error.message ?? ""
    const normalized = message.toLowerCase()
    if (normalized.includes("not found") || normalized.includes("object not found")) {
      return { success: false, error: "NOT_FOUND" }
    }
    console.error("[v0] Failed to create signed URL for activity file:", error)
    return { success: false, error: message }
  }

  return { success: true, url: data?.signedUrl ?? null }
}

export async function listPupilActivitySubmissionsAction(
  lessonId: string,
  activityId: string,
  pupilId: string,
) {
  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(LESSON_FILES_BUCKET)

  const directories = [
    buildSubmissionDirectory(lessonId, activityId, pupilId),
    buildLegacySubmissionDirectory(lessonId, activityId, pupilId),
  ].filter((value, index, array) => array.indexOf(value) === index)

  try {
    const seen = new Set<string>()
    const collected: Array<z.infer<typeof ActivityFileSchema>> = []

    for (const directory of directories) {
      const { data, error } = await bucket.list(directory, { limit: 100 })

      if (error) {
        if (isStorageNotFoundError(error)) {
          continue
        }
        console.error("[v0] Failed to list pupil submissions:", error)
        return ActivityFilesReturnValue.parse({ data: null, error: error.message })
      }

      for (const file of data ?? []) {
        const fullPath = `${directory}/${file.name}`
        if (seen.has(fullPath)) {
          continue
        }
        seen.add(fullPath)
        collected.push(
          ActivityFileSchema.parse({
            name: file.name,
            path: fullPath,
            created_at: file.created_at ?? undefined,
            updated_at: file.updated_at ?? undefined,
            last_accessed_at: file.last_accessed_at ?? undefined,
            size: file.metadata?.size ?? undefined,
          }),
        )
      }
    }

    const normalized = collected.sort((a, b) => {
      const aTime = Date.parse(a.updated_at ?? a.created_at ?? "0")
      const bTime = Date.parse(b.updated_at ?? b.created_at ?? "0")
      return bTime - aTime
    })

    return ActivityFilesReturnValue.parse({ data: normalized, error: null })
  } catch (error) {
    console.error("[v0] Unexpected error listing pupil submissions:", error)
    return ActivityFilesReturnValue.parse({
      data: null,
      error: "Unable to load pupil submissions.",
    })
  }
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

  const submittedAt = new Date().toISOString()
  const submissionResult = await upsertUploadSubmissionRecord({
    supabase,
    activityId,
    pupilId,
    fileName,
    submittedAt,
  })

  if (!submissionResult.success) {
    await bucket.remove([path])
    return { success: false, error: submissionResult.error ?? "Unable to record submission." }
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
  const paths = [
    buildSubmissionPath(lessonId, activityId, pupilId, fileName),
    buildLegacySubmissionPath(lessonId, activityId, pupilId, fileName),
  ].filter((value, index, array) => array.indexOf(value) === index)

  let deleted = false
  let lastError: { message?: string } | null = null

  for (const path of paths) {
    const { error } = await bucket.remove([path])
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

  const cleanupResult = await cleanupUploadSubmissionRecord({ supabase, activityId, pupilId })
  if (!cleanupResult.success) {
    return { success: false, error: cleanupResult.error ?? "Unable to update submission." }
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
  const paths = [
    buildSubmissionPath(lessonId, activityId, pupilId, fileName),
    buildLegacySubmissionPath(lessonId, activityId, pupilId, fileName),
  ].filter((value, index, array) => array.indexOf(value) === index)

  let lastError: { message?: string } | null = null

  for (const path of paths) {
    const { data, error } = await bucket.createSignedUrl(path, 60 * 10)
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

type UploadSubmissionSyncParams = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  activityId: string
  pupilId: string
  fileName: string
  submittedAt: string
}

async function upsertUploadSubmissionRecord({
  supabase,
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

  const { data: existing, error: fetchError } = await supabase
    .from("submissions")
    .select("submission_id")
    .eq("activity_id", activityId)
    .eq("user_id", pupilId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (fetchError) {
    console.error("[v0] Failed to load existing upload submission:", fetchError)
    return { success: false, error: "Unable to record submission." }
  }

  if (existing?.submission_id) {
    const { error: updateError } = await supabase
      .from("submissions")
      .update({ body: payload, submitted_at: submittedAt })
      .eq("submission_id", existing.submission_id)

    if (updateError) {
      console.error("[v0] Failed to update upload submission record:", updateError)
      return { success: false, error: "Unable to record submission." }
    }
    return { success: true }
  }

  const { error: insertError } = await supabase
    .from("submissions")
    .insert({
      activity_id: activityId,
      user_id: pupilId,
      body: payload,
      submitted_at: submittedAt,
    })

  if (insertError) {
    console.error("[v0] Failed to create upload submission record:", insertError)
    return { success: false, error: "Unable to record submission." }
  }

  return { success: true }
}

type UploadSubmissionCleanupParams = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  activityId: string
  pupilId: string
}

async function cleanupUploadSubmissionRecord({
  supabase,
  activityId,
  pupilId,
}: UploadSubmissionCleanupParams) {
  const { data, error } = await supabase
    .from("submissions")
    .select("submission_id, body")
    .eq("activity_id", activityId)
    .eq("user_id", pupilId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[v0] Failed to load upload submission for cleanup:", error)
    return { success: false, error: "Unable to update submission." }
  }

  if (!data) {
    return { success: true }
  }

  const record =
    data.body && typeof data.body === "object" ? { ...(data.body as Record<string, unknown>) } : {}
  const hasOverride =
    typeof record.teacher_override_score === "number" && Number.isFinite(record.teacher_override_score)

  if (hasOverride) {
    const { error: updateError } = await supabase
      .from("submissions")
      .update({
        body: {
          ...record,
          upload_submission: false,
          upload_file_name: null,
          upload_updated_at: null,
        },
      })
      .eq("submission_id", data.submission_id)

    if (updateError) {
      console.error("[v0] Failed to retain override submission during cleanup:", updateError)
      return { success: false, error: "Unable to update submission." }
    }
    return { success: true }
  }

  const { error: deleteError } = await supabase
    .from("submissions")
    .delete()
    .eq("submission_id", data.submission_id)

  if (deleteError) {
    console.error("[v0] Failed to delete upload submission record:", deleteError)
    return { success: false, error: "Unable to update submission." }
  }

  return { success: true }
}
