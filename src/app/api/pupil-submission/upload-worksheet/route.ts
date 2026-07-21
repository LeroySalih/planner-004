import { NextResponse } from "next/server"
import { Client } from "pg"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { logActivitySubmissionEvent } from "@/lib/activity-logging"
import { invokeImageOcr } from "@/lib/ai/ocr-client"
import { UploadWorksheetSubmissionBodySchema } from "@/types"
import { clearResubmitRequest, getNextAttemptNumber } from "@/lib/server-actions/submission-attempts"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png"]
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  // Some browsers/OSes send this generic type instead of a specific image type.
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
  const tag = `[pupil-upload-worksheet:${requestId}]`

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

  // Validate and upload each file; collect image metadata.
  const images: Array<{ filePath: string; fileName: string }> = []
  for (const file of files) {
    const fileName = file.name
    const lowerName = fileName.toLowerCase()
    const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
    const hasAllowedMime = file.type === "" || ALLOWED_MIME_TYPES.has(file.type)
    if (!hasAllowedExtension || !hasAllowedMime) {
      return NextResponse.json({ success: false, error: "Only JPEG or PNG photos are allowed" }, { status: 415 })
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ success: false, error: "File exceeds 10MB limit" }, { status: 413 })
    }

    // Unique stored name so re-uploading a photo with the same filename doesn't
    // collide with a previous attempt's file (stored_files unique constraint).
    // Keep the original name for display.
    const storedName = `${crypto.randomUUID().slice(0, 8)}-${fileName}`.replace(/\s+/g, "_")
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

    images.push({ filePath, fileName })
  }

  const submittedAt = new Date().toISOString()
  let submissionId: string | null = null
  const client = createPgClient()

  try {
    await client.connect()

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
          values ($1, $2, $3, $4, $5, 'submitted', 'reading')
          returning submission_id
        `,
        [activityId, userId, attemptNumber, submissionBody, submittedAt],
      )
      submissionId = newRows[0]?.submission_id ?? null

      await clearResubmitRequest(activityId, userId)

      const firstFileName = images[0]?.fileName ?? ""
      await logActivitySubmissionEvent({ submissionId, activityId, lessonId, pupilId: userId, fileName: firstFileName, submittedAt })

    } catch (err) {
      console.error(`${tag} DB upsert failed — rolling back storage`, { error: err })
      await storage.remove(images.map((img) => img.filePath))
      return NextResponse.json({ success: false, error: "Unable to record submission." }, { status: 500 })
    }

    // Emit SSE so the pupil UI transitions to "reading" immediately after insert.
    if (submissionId) {
      void emitSubmissionEvent("submission.updated", {
        submissionId,
        activityId,
        pupilId: userId,
        markStatus: "reading",
      })
    }

    // Post-insert: read stored files back and invoke OCR. This runs OUTSIDE the DB-insert
    // try/catch so failures here never trigger storage rollback or a 500 response — the
    // submission row and uploaded files are already committed and must be kept.
    if (submissionId) {
      try {
        const callbackBase = (process.env.AI_MARKING_CALLBACK_URL ?? "").replace(/\/$/, "")
        const ocrImages: Array<{ base64: string; fileName: string }> = []
        for (const img of images) {
          const { stream, error: streamError } = await storage.getFileStream(img.filePath)
          if (streamError || !stream) {
            throw new Error(`Failed to read image at ${img.filePath}: ${streamError?.message ?? "no stream"}`)
          }
          const chunks: Buffer[] = []
          for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          const base64 = Buffer.concat(chunks).toString("base64")
          ocrImages.push({ base64, fileName: img.fileName })
        }

        await invokeImageOcr({
          submission_id: submissionId,
          activity_id: activityId,
          pupil_id: userId,
          group_assignment_id: groupAssignmentId ?? undefined,
          webhook_url: `${callbackBase}/webhooks/image-to-text`,
          images: ocrImages,
        })
      } catch (err) {
        // Read failure OR invoke failure: mark submission as reading-error.
        // Do NOT remove storage (images are valid) and do NOT return 500.
        console.error(`${tag} OCR read/invoke failed — setting mark_status reading-error`, err)
        try {
          await client.query(
            `update submissions set mark_status = 'reading-error', mark_error = $1 where submission_id = $2`,
            ["Could not read images. Please try re-uploading.", submissionId],
          )
          void emitSubmissionEvent("submission.updated", {
            submissionId,
            activityId,
            pupilId: userId,
            markStatus: "reading-error",
            markError: "Could not read images. Please try re-uploading.",
          })
        } catch (updateErr) {
          console.error(`${tag} Failed to update submission to reading-error`, updateErr)
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

  console.log(`${tag} Upload complete`, { submissionId, imageCount: images.length, lessonId, activityId, pupilId, durationMs: Date.now() - startedAt })

  return NextResponse.json({ success: true, submissionId, imagePaths: images.map((img) => img.filePath) })
}
