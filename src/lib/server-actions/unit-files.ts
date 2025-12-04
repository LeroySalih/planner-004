"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireTeacherProfile } from "@/lib/auth"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { withTelemetry } from "@/lib/telemetry"

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

export async function listUnitFilesAction(
  unitId: string,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const routeTag = options?.routeTag ?? "/units:files"

  const authProfile = await requireTeacherProfile()

  return withTelemetry(
    {
      routeTag,
      functionName: "listUnitFilesAction",
      params: { unitId, userId: authProfile.userId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for listing unit files:", { unitId })

      const storage = createLocalStorageClient(UNIT_FILES_BUCKET)
      const { data, error } = await storage.list(unitId, { limit: 100 })

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
    },
  )
}

export async function uploadUnitFileAction(formData: FormData) {
  await requireTeacherProfile()

  const unitId = formData.get("unitId")
  const file = formData.get("file")

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
  const storage = createLocalStorageClient(UNIT_FILES_BUCKET)
  const fullPath = buildFilePath(unitId, fileName)
  const arrayBuffer = await file.arrayBuffer()
  const { error } = await storage.upload(fullPath, arrayBuffer, {
    contentType: file.type || "application/octet-stream",
    originalPath: fullPath,
  })

  if (error) {
    console.error("[v0] Failed to upload unit file:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}

export async function deleteUnitFileAction(unitId: string, fileName: string) {
  await requireTeacherProfile()

  const storage = createLocalStorageClient(UNIT_FILES_BUCKET)
  const { error } = await storage.remove([buildFilePath(unitId, fileName)])

  if (error) {
    console.error("[v0] Failed to delete unit file:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}

export async function getUnitFileDownloadUrlAction(unitId: string, fileName: string) {
  await requireTeacherProfile()

  const storage = createLocalStorageClient(UNIT_FILES_BUCKET)
  const { data, error } = await storage.createSignedUrl(buildFilePath(unitId, fileName))

  if (error) {
    console.error("[v0] Failed to create download URL for unit file:", error)
    return { success: false, error: error.message }
  }

  return { success: true, url: data?.signedUrl ?? null }
}
