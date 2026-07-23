import { NextResponse } from "next/server"
import { Client } from "pg"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { logActivitySubmissionEvent } from "@/lib/activity-logging"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import { UploadWorksheetSubmissionBodySchema } from "@/types"
import { clearResubmitRequest, getNextAttemptNumber } from "@/lib/server-actions/submission-attempts"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png"]
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "application/octet-stream"])

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

async function resolvePupilStorageKey(pupilId: string): Promise<string> {
  const { rows } = await query<{ email: string | null }>(
    `select email from profiles where user_id = $1 limit 1`,
    [pupilId],
  )
  const email = rows?.[0]?.email?.trim()
  return email && email.length > 0 ? email : pupilId
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[pupil-mark-worksheet:${requestId}]`

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
  const files = formData.getAll("files").filter((f): f is File => f instanceof File)

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing lessonId" }, { status: 400 })
  }
  if (typeof activityId !== "string" || activityId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing activityId" }, { status: 400 })
  }
  if (typeof pupilId !== "string" || pupilId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing pupilId" }, { status: 400 })
  }
  if (files.length === 0) {
    return NextResponse.json({ success: false, error: "No files provided." }, { status: 400 })
  }
  if (profile.userId !== pupilId && !hasRole(profile, "teacher")) {
    return NextResponse.json({ success: false, error: "You are not allowed to upload files for this pupil." }, { status: 403 })
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

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)

  const images: Array<{ filePath: string; fileName: string }> = []
  for (const file of files) {
    const lowerName = file.name.toLowerCase()
    const okExt = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
    const okMime = file.type === "" || ALLOWED_MIME_TYPES.has(file.type)
    if (!okExt || !okMime) {
      return NextResponse.json({ success: false, error: "Only JPEG or PNG photos are allowed" }, { status: 415 })
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ success: false, error: "File exceeds 10MB limit" }, { status: 413 })
    }

    // Unique stored name so re-uploading a photo with the same filename doesn't
    // collide with a previous attempt (which failed the upload and left the old
    // photo showing). Keep the original name for display.
    const storedName = `${crypto.randomUUID().slice(0, 8)}-${file.name}`.replace(/\s+/g, "_")
    const filePath = buildSubmissionPath(lessonId, activityId, pupilStorageKey, storedName)
    let arrayBuffer: ArrayBuffer
    try {
      arrayBuffer = await file.arrayBuffer()
    } catch (err) {
      console.error(`${tag} Failed to read file buffer`, err)
      return NextResponse.json({ success: false, error: "Failed to read file." }, { status: 500 })
    }
    const { error: uploadError } = await storage.upload(filePath, arrayBuffer, {
      contentType: file.type || "image/jpeg",
      uploadedBy: uploaderId,
      originalPath: filePath,
    })
    if (uploadError) {
      console.error(`${tag} Storage upload failed`, { filePath, error: uploadError.message })
      return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
    }
    images.push({ filePath, fileName: file.name })
  }

  const submittedAt = new Date().toISOString()
  let submissionId: string | null = null
  const client = createPgClient()

  try {
    await client.connect()

    // Store with 'waiting' when there is an assignment to mark against (the
    // queue will pick it up); otherwise leave unmarked (no assignment = no AI).
    const initialMarkStatus = groupAssignmentId ? "waiting" : null
    try {
      const submissionBody = UploadWorksheetSubmissionBodySchema.parse({
        images,
        extractedText: null,
        is_correct: false,
        success_criteria_scores: {},
      })
      const attemptNumber = await getNextAttemptNumber(activityId, userId)
      const { rows: newRows } = await client.query(
        `
          insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status, mark_status)
          values ($1, $2, $3, $4, $5, 'submitted', $6)
          returning submission_id
        `,
        [activityId, userId, attemptNumber, submissionBody, submittedAt, initialMarkStatus],
      )
      submissionId = newRows[0]?.submission_id ?? null
      await clearResubmitRequest(activityId, userId)
      await logActivitySubmissionEvent({ submissionId, activityId, lessonId, pupilId: userId, fileName: images[0]?.fileName ?? "", submittedAt })
    } catch (err) {
      console.error(`${tag} DB insert failed — rolling back storage`, err)
      await storage.remove(images.map((img) => img.filePath))
      return NextResponse.json({ success: false, error: "Unable to record submission." }, { status: 500 })
    }

    // Route AI marking through the shared queue (single pathway). The queue
    // processor reads the pupil + teacher images and calls the worksheet flow.
    if (submissionId && groupAssignmentId) {
      try {
        await enqueueMarkingTasks(groupAssignmentId, [{ submissionId }])
        void triggerQueueProcessor()
        void emitSubmissionEvent("submission.updated", { submissionId, activityId, pupilId: userId, markStatus: "waiting" })
      } catch (err) {
        console.error(`${tag} Failed to enqueue for marking — setting marking-error`, err)
        const message = err instanceof Error ? err.message : "Could not send your work for marking."
        try {
          await client.query(
            `update submissions set mark_status = 'marking-error', mark_error = $1 where submission_id = $2`,
            [message, submissionId],
          )
          void emitSubmissionEvent("submission.updated", {
            submissionId,
            activityId,
            pupilId: userId,
            markStatus: "marking-error",
            markError: message,
          })
        } catch (updateErr) {
          console.error(`${tag} Failed to set marking-error`, updateErr)
        }
      }
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
      fileName: images[0]?.fileName ?? "",
      submissionStatus: "submitted",
      isFlagged: false,
    })
  } catch (err) {
    console.error(`${tag} SSE emit failed (non-fatal)`, err)
  }

  return NextResponse.json({ success: true, submissionId, imagePaths: images.map((img) => img.filePath) })
}
