import { NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

function buildFilePath(lessonId: string, fileName: string) {
  return `${lessonId}/${fileName}`
}

function toIsoOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  return undefined
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[lesson-files-upload:${requestId}]`
  const startedAt = Date.now()

  console.log(`${tag} Request received`)

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    console.warn(`${tag} Rejected: unauthenticated`)
    return NextResponse.json({ success: false, error: "Unauthorized", files: null }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error(`${tag} Failed to parse form data`, err)
    return NextResponse.json({ success: false, error: "Invalid request body", files: null }, { status: 400 })
  }

  const lessonId = formData.get("lessonId")
  const unitId = formData.get("unitId")
  const file = formData.get("file")

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    console.warn(`${tag} Missing lessonId`)
    return NextResponse.json({ success: false, error: "Missing lessonId", files: null }, { status: 400 })
  }
  if (typeof unitId !== "string" || unitId.trim() === "") {
    console.warn(`${tag} Missing unitId`)
    return NextResponse.json({ success: false, error: "Missing unitId", files: null }, { status: 400 })
  }
  if (!(file instanceof File)) {
    console.warn(`${tag} No file in request`)
    return NextResponse.json({ success: false, error: "No file provided", files: null }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    console.warn(`${tag} File too large: ${file.size} bytes`, { fileName: file.name })
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit", files: null }, { status: 413 })
  }

  const fileName = file.name
  const fullPath = buildFilePath(lessonId, fileName)

  console.log(`${tag} Uploading`, { fileName, fileSize: file.size, lessonId, unitId })

  let arrayBuffer: ArrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
  } catch (err) {
    console.error(`${tag} Failed to read file buffer`, err)
    return NextResponse.json({ success: false, error: "Failed to read file.", files: null }, { status: 500 })
  }

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const { error } = await storage.upload(fullPath, arrayBuffer, {
    contentType: file.type || "application/octet-stream",
    originalPath: fullPath,
  })

  if (error) {
    console.error(`${tag} Storage upload failed`, { fullPath, error: error.message })
    return NextResponse.json({ success: false, error: error.message, files: null }, { status: 500 })
  }

  let files = null
  try {
    const { data: freshList, error: listError } = await storage.list(lessonId, { limit: 100 })
    if (!listError) {
      files = freshList?.map((item) => ({
        name: item.name,
        path: buildFilePath(lessonId, item.name),
        created_at: toIsoOrUndefined(item.created_at),
        updated_at: toIsoOrUndefined(item.updated_at),
        last_accessed_at: toIsoOrUndefined(item.last_accessed_at),
        size: item.metadata?.size ?? undefined,
      })) ?? null
    }
  } catch (listErr) {
    console.warn(`${tag} Unable to refresh file list after upload (non-fatal)`, listErr)
  }

  console.log(`${tag} Complete`, { fullPath, totalMs: Date.now() - startedAt })
  return NextResponse.json({ success: true, error: null, files })
}
