import { NextResponse } from "next/server"
import { Client } from "pg"

import { getAuthenticatedProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

function buildSubmissionPath(lessonId: string, activityId: string, pupilStorageKey: string, fileName: string) {
  return `lessons/${lessonId}/activities/${activityId}/${pupilStorageKey}/${fileName}`
}

function createPgClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL is not configured")
  return new Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  })
}

async function resolvePupilStorageKey(userId: string): Promise<string> {
  const { rows } = await query<{ email: string | null }>(
    `select email from profiles where user_id = $1 limit 1`,
    [userId],
  )
  return rows[0]?.email?.trim() ?? userId
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[share-my-work-upload:${requestId}]`
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

  const lessonId = formData.get("lessonId")
  const activityId = formData.get("activityId")
  const file = formData.get("file")

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing lessonId" }, { status: 400 })
  }
  if (typeof activityId !== "string" || activityId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing activityId" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    console.warn(`${tag} Rejected MIME type: ${file.type}`)
    return NextResponse.json(
      { success: false, error: "Only PNG, JPEG, GIF, and WebP images are allowed" },
      { status: 415 },
    )
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    console.warn(`${tag} File too large: ${file.size} bytes`, { fileName: file.name })
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit" }, { status: 413 })
  }

  const userId = profile.userId
  const fileName = file.name

  console.log(`${tag} Uploading`, { fileName, fileSize: file.size, fileType: file.type, lessonId, activityId })

  const pupilStorageKey = profile.email?.trim() ?? (await resolvePupilStorageKey(userId))
  const path = buildSubmissionPath(lessonId, activityId, pupilStorageKey, fileName)
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadError } = await storage.upload(path, arrayBuffer, {
    contentType: file.type,
    uploadedBy: userId,
    originalPath: path,
  })

  if (uploadError) {
    console.error(`${tag} Storage upload failed`, { path, error: uploadError.message })
    return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
  }

  console.log(`${tag} Storage upload succeeded`, { path, durationMs: Date.now() - startedAt })

  const fileId = crypto.randomUUID()
  const client = createPgClient()
  let submissionId: string

  try {
    await client.connect()

    const { rows: existingRows } = await client.query(
      `select submission_id, body from submissions where activity_id = $1 and user_id = $2 order by submitted_at desc limit 1`,
      [activityId, userId],
    )

    const existing = existingRows[0]
    const files: Array<{ fileId: string; fileName: string; mimeType: string; order: number }> =
      existing?.body?.files && Array.isArray(existing.body.files) ? existing.body.files : []

    files.push({ fileId, fileName, mimeType: file.type, order: files.length })

    const body = { files }
    const submittedAt = new Date().toISOString()

    if (existing) {
      submissionId = existing.submission_id
      await client.query(
        `update submissions set body = $1, submitted_at = $2 where submission_id = $3`,
        [JSON.stringify(body), submittedAt, submissionId],
      )
      console.log(`${tag} Updated existing submission`, { submissionId })
    } else {
      const { rows: insertRows } = await client.query<{ submission_id: string }>(
        `insert into submissions (submission_id, activity_id, user_id, body, submitted_at) values (gen_random_uuid(), $1, $2, $3, $4) returning submission_id`,
        [activityId, userId, JSON.stringify(body), submittedAt],
      )
      submissionId = insertRows[0].submission_id
      console.log(`${tag} Created new submission`, { submissionId })
    }
  } catch (err) {
    console.error(`${tag} DB upsert failed — rolling back storage`, { path, error: err })
    await storage.remove([path])
    return NextResponse.json({ success: false, error: "Failed to save submission" }, { status: 500 })
  } finally {
    try { await client.end() } catch { /* ignore */ }
  }

  console.log(`${tag} Complete`, { submissionId, fileName, totalMs: Date.now() - startedAt })
  return NextResponse.json({ success: true, data: { fileId, fileName, submissionId } })
}
