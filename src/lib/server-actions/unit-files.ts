"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createSupabaseServerClient } from "@/lib/supabase/server"

const UNIT_FILES_BUCKET = "units"

const UnitFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  last_accessed_at: z.string().optional(),
  size: z.number().optional(),
})

const UnitFilesReturnValue = z.object({
  data: z.array(UnitFileSchema).nullable(),
  error: z.string().nullable(),
})

function buildFilePath(unitId: string, fileName: string) {
  return `${unitId}/${fileName}`
}

function buildVersionedName(name: string) {
  const dotIndex = name.lastIndexOf(".")
  const now = new Date()
  const pad = (value: number) => value.toString().padStart(2, "0")
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(
    now.getHours(),
  )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`

  if (dotIndex === -1) {
    return `${name}_${timestamp}`
  }
  const base = name.slice(0, dotIndex)
  const extension = name.slice(dotIndex)
  return `${base}_${timestamp}${extension}`
}

export async function listUnitFilesAction(unitId: string) {
  console.log("[v0] Server action started for listing unit files:", { unitId })

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.storage
    .from(UNIT_FILES_BUCKET)
    .list(unitId, { limit: 100 })

  if (error) {
    console.error("[v0] Failed to list unit files:", error)
    return UnitFilesReturnValue.parse({ data: null, error: error.message })
  }

  const normalized = (data ?? [])
    .map((file) =>
      UnitFileSchema.parse({
        name: file.name,
        path: buildFilePath(unitId, file.name),
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

  return UnitFilesReturnValue.parse({ data: normalized, error: null })
}

export async function uploadUnitFileAction(formData: FormData) {
  const unitId = formData.get("unitId")
  const file = formData.get("file")

  if (typeof unitId !== "string" || unitId.trim() === "") {
    return { success: false, error: "Missing unit identifier" }
  }

  if (!(file instanceof File)) {
    return { success: false, error: "No file provided" }
  }

  const fileName = file.name
  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(UNIT_FILES_BUCKET)
  const fullPath = buildFilePath(unitId, fileName)

  const { data: existingFiles, error: listError } = await bucket.list(unitId, {
    search: fileName,
  })

  if (listError) {
    console.error("[v0] Failed to check existing unit files:", listError)
    return { success: false, error: listError.message }
  }

  const alreadyExists = (existingFiles ?? []).some((item) => item.name === fileName)

  if (alreadyExists) {
    const versionedName = buildVersionedName(fileName)
    const { error: moveError } = await bucket.move(fullPath, buildFilePath(unitId, versionedName))

    if (moveError) {
      console.error("[v0] Failed to version existing unit file:", moveError)
      return { success: false, error: moveError.message }
    }
  }

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadError } = await bucket.upload(fullPath, arrayBuffer, {
    upsert: true,
    contentType: file.type || "application/octet-stream",
  })

  if (uploadError) {
    console.error("[v0] Failed to upload unit file:", uploadError)
    return { success: false, error: uploadError.message }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}

export async function deleteUnitFileAction(unitId: string, fileName: string) {
  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(UNIT_FILES_BUCKET)
  const { error } = await bucket.remove([buildFilePath(unitId, fileName)])

  if (error) {
    console.error("[v0] Failed to delete unit file:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}

export async function getUnitFileDownloadUrlAction(unitId: string, fileName: string) {
  const supabase = await createSupabaseServerClient()
  const bucket = supabase.storage.from(UNIT_FILES_BUCKET)
  const { data, error } = await bucket.createSignedUrl(buildFilePath(unitId, fileName), 60 * 10)

  if (error) {
    console.error("[v0] Failed to create signed URL for unit file:", error)
    return { success: false, error: error.message }
  }

  return { success: true, url: data?.signedUrl ?? null }
}
