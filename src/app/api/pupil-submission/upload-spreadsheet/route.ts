import { NextResponse } from "next/server"
import { Client } from "pg"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { logActivitySubmissionEvent } from "@/lib/activity-logging"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import { UploadSpreadsheetSubmissionBodySchema } from "@/types"
import { clearResubmitRequest, getNextAttemptNumber } from "@/lib/server-actions/submission-attempts"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_EXTENSION = ".xlsx"
const ALLOWED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Some browsers/OSes send this generic type instead of the xlsx-specific one or an empty string.
  "application/octet-stream",
])

function buildSubmissionPath(lessonId: string, activityId: string, pupilStorageKey: string, fileName: string) {
  return `lessons/${lessonId}/activities/${activityId}/${pupilStorageKey}/${fileName}`
}

function createPgClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured")
  }
  return new Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  })
}

async function resolvePupilStorageKey(pupilId: string): Promise<string> {
  const { rows } = await query<{ email: string | null }>(
    `select email from profiles where user_id = $1 limit 1`,
    [pupilId],
  )
  const email = rows?.[0]?.email?.trim()
  return email && email.length > 0 ? email : pupilId
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[pupil-upload-spreadsheet:${requestId}]`

  const profile = await getAuthenticatedProfile()
  if (!profile) {
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
  const pupilId = formData.get("pupilId")
  const groupAssignmentIdRaw = formData.get("groupAssignmentId")
  const groupAssignmentId = typeof groupAssignmentIdRaw === "string" && groupAssignmentIdRaw.trim() !== "" ? groupAssignmentIdRaw : null
  const file = formData.get("file")

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing lessonId" }, { status: 400 })
  }
  if (typeof activityId !== "string" || activityId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing activityId" }, { status: 400 })
  }
  if (typeof pupilId !== "string" || pupilId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing pupilId" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }

  if (profile.userId !== pupilId && !hasRole(profile, "teacher")) {
    return NextResponse.json({ success: false, error: "You are not allowed to upload files for this pupil." }, { status: 403 })
  }

  const fileName = file.name
  const hasXlsxExtension = fileName.toLowerCase().endsWith(ALLOWED_EXTENSION)
  const hasAllowedMime = file.type === "" || ALLOWED_MIME_TYPES.has(file.type)
  if (!hasXlsxExtension || !hasAllowedMime) {
    return NextResponse.json({ success: false, error: "Only .xlsx files are allowed" }, { status: 415 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit" }, { status: 413 })
  }

  const userId = pupilId
  const uploaderId = profile.userId

  let pupilStorageKey: string
  try {
    pupilStorageKey = await resolvePupilStorageKey(pupilId)
  } catch (err) {
    console.error(`${tag} Failed to resolve pupil storage key`, err)
    return NextResponse.json({ success: false, error: "Unable to process upload." }, { status: 500 })
  }

  const path = buildSubmissionPath(lessonId, activityId, pupilStorageKey, fileName)
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)

  let arrayBuffer: ArrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
  } catch (err) {
    console.error(`${tag} Failed to read file buffer`, err)
    return NextResponse.json({ success: false, error: "Failed to read file." }, { status: 500 })
  }

  // Always write to the same path (no versioning) so a re-upload simply replaces the file.
  const { error: uploadError } = await storage.upload(path, arrayBuffer, {
    contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    uploadedBy: uploaderId,
    originalPath: path,
  })

  if (uploadError) {
    console.error(`${tag} Storage upload failed`, { path, error: uploadError.message })
    return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
  }

  const submittedAt = new Date().toISOString()
  let submissionId: string | null = null
  const client = createPgClient()

  try {
    await client.connect()

    try {
      const submissionBody = UploadSpreadsheetSubmissionBodySchema.parse({
        filePath: path,
        fileName,
        ai_model_score: null,
        ai_model_feedback: null,
        is_correct: false,
        success_criteria_scores: {},
      })

      const attemptNumber = await getNextAttemptNumber(activityId, userId)
      const { rows: newRows } = await client.query(
        `
          insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status)
          values ($1, $2, $3, $4, $5, 'submitted')
          returning submission_id
        `,
        [activityId, userId, attemptNumber, submissionBody, submittedAt],
      )
      submissionId = newRows[0]?.submission_id ?? null

      await clearResubmitRequest(activityId, userId)

      await logActivitySubmissionEvent({ submissionId, activityId, lessonId, pupilId: userId, fileName, submittedAt })
    } catch (err) {
      console.error(`${tag} DB upsert failed — rolling back storage`, { path, error: err })
      await storage.remove([path])
      return NextResponse.json({ success: false, error: "Unable to record submission." }, { status: 500 })
    }
  } finally {
    try {
      await client.end()
    } catch {
      // ignore
    }
  }

  try {
    emitSubmissionEvent("submission.uploaded", {
      submissionId,
      activityId,
      pupilId: userId,
      submittedAt,
      fileName,
      submissionStatus: "submitted",
      isFlagged: false,
    })
  } catch (err) {
    console.error(`${tag} SSE emit failed (non-fatal)`, err)
  }

  // Auto-trigger AI marking on every submit/re-submit — no debounce, since
  // each call here represents a complete file replace, not a keystroke.
  if (submissionId && groupAssignmentId) {
    try {
      await enqueueMarkingTasks(groupAssignmentId, [{ submissionId }])
      await triggerQueueProcessor()
    } catch (err) {
      console.error(`${tag} Failed to enqueue AI marking (non-fatal)`, err)
    }
  } else if (submissionId && !groupAssignmentId) {
    console.warn(`${tag} No groupAssignmentId provided — skipping AI marking enqueue`, { submissionId })
  }

  console.log(`${tag} Upload complete`, { submissionId, fileName, lessonId, activityId, pupilId, durationMs: Date.now() - startedAt })

  return NextResponse.json({ success: true, submissionId })
}
