import { NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitUploadEvent } from "@/lib/sse/topics"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

function buildFilePath(lessonId: string, activityId: string, fileName: string) {
  return `lessons/${lessonId}/activities/${activityId}/${fileName}`
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[activity-files-upload:${requestId}]`
  const startedAt = Date.now()

  console.log(`${tag} Request received`)

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    console.warn(`${tag} Rejected: unauthenticated`)
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error(`${tag} Failed to parse form data`, err)
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 })
  }

  const unitId = formData.get("unitId")
  const lessonId = formData.get("lessonId")
  const activityId = formData.get("activityId")
  const file = formData.get("file")

  if (typeof unitId !== "string" || unitId.trim() === "") {
    console.warn(`${tag} Missing unitId`)
    return NextResponse.json({ success: false, error: "Missing unitId" }, { status: 400 })
  }
  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    console.warn(`${tag} Missing lessonId`)
    return NextResponse.json({ success: false, error: "Missing lessonId" }, { status: 400 })
  }
  if (typeof activityId !== "string" || activityId.trim() === "") {
    console.warn(`${tag} Missing activityId`)
    return NextResponse.json({ success: false, error: "Missing activityId" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    console.warn(`${tag} No file in request`)
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    console.warn(`${tag} File too large: ${file.size} bytes`, { fileName: file.name })
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit" }, { status: 413 })
  }

  const fileName = file.name
  const fullPath = buildFilePath(lessonId, activityId, fileName)

  console.log(`${tag} Uploading`, { fileName, fileSize: file.size, lessonId, activityId, unitId })

  let arrayBuffer: ArrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
  } catch (err) {
    console.error(`${tag} Failed to read file buffer`, err)
    return NextResponse.json({ success: false, error: "Failed to read file." }, { status: 500 })
  }

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const { error } = await storage.upload(fullPath, arrayBuffer, {
    contentType: file.type || "application/octet-stream",
    uploadedBy: profile.userId,
    originalPath: fullPath,
  })

  if (error) {
    console.error(`${tag} Storage upload failed`, { fullPath, error: error.message })
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  try {
    await emitUploadEvent("upload.activity.file_added", {
      unitId,
      lessonId,
      activityId,
      fileName,
      submittedBy: profile.userId,
    })
  } catch (err) {
    console.error(`${tag} SSE emit failed (non-fatal)`, err)
  }

  console.log(`${tag} Complete`, { fullPath, totalMs: Date.now() - startedAt })
  return NextResponse.json({ success: true })
}
