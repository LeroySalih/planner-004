import { NextResponse } from "next/server"
import { Client } from "pg"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { logActivitySubmissionEvent } from "@/lib/activity-logging"
import { invokeWorksheetMarking, type WorksheetMarkingImage } from "@/lib/ai/worksheet-marking-client"
import { MarkWorksheetActivityBodySchema, UploadWorksheetSubmissionBodySchema } from "@/types"
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

/** Prepend the selected marking-guidance template's content to the free-text guidance. */
async function resolveMarkingGuidance(guidance: string, guidanceId: string | undefined): Promise<string> {
  const parts: string[] = []
  if (guidanceId) {
    try {
      const { rows } = await query<{ content: string | null }>(
        `select content from marking_guidances where id = $1 limit 1`,
        [guidanceId],
      )
      const content = rows?.[0]?.content?.trim()
      if (content) parts.push(content)
    } catch (err) {
      console.error("[pupil-mark-worksheet] Failed to load marking guidance", err)
    }
  }
  if (guidance.trim()) parts.push(guidance.trim())
  return parts.join("\n\n")
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

    // Load the activity's teacher config (answer images + guidance + max_marks).
    let answerImages: Array<{ filePath: string; fileName: string }> = []
    let markingGuidanceText = ""
    let markingGuidanceId: string | undefined
    let maxMarks = 1
    try {
      const { rows } = await client.query(
        `select body_data, coalesce(max_marks, 1) as max_marks from activities where activity_id = $1 limit 1`,
        [activityId],
      )
      const row = rows[0]
      if (row) {
        maxMarks = Number(row.max_marks) || 1
        const parsed = MarkWorksheetActivityBodySchema.safeParse(row.body_data)
        if (parsed.success) {
          answerImages = parsed.data.answerImages
          markingGuidanceText = parsed.data.markingGuidance
          markingGuidanceId = parsed.data.markingGuidanceId
        }
      }
    } catch (err) {
      console.error(`${tag} Failed to load activity config`, err)
    }

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
          values ($1, $2, $3, $4, $5, 'submitted', 'marking')
          returning submission_id
        `,
        [activityId, userId, attemptNumber, submissionBody, submittedAt],
      )
      submissionId = newRows[0]?.submission_id ?? null
      await clearResubmitRequest(activityId, userId)
      await logActivitySubmissionEvent({ submissionId, activityId, lessonId, pupilId: userId, fileName: images[0]?.fileName ?? "", submittedAt })
    } catch (err) {
      console.error(`${tag} DB insert failed — rolling back storage`, err)
      await storage.remove(images.map((img) => img.filePath))
      return NextResponse.json({ success: false, error: "Unable to record submission." }, { status: 500 })
    }

    if (submissionId) {
      void emitSubmissionEvent("submission.updated", { submissionId, activityId, pupilId: userId, markStatus: "marking" })
    }

    // Send images directly to the AI-MARK-WORKSHEET flow (no OCR).
    if (submissionId) {
      try {
        const callbackBase = (process.env.AI_MARKING_CALLBACK_URL ?? "").replace(/\/$/, "")

        const toBase64 = async (list: Array<{ filePath: string; fileName: string }>): Promise<WorksheetMarkingImage[]> => {
          const out: WorksheetMarkingImage[] = []
          for (const img of list) {
            const { stream, error: streamError } = await storage.getFileStream(img.filePath)
            if (streamError || !stream) {
              throw new Error(`Failed to read image at ${img.filePath}: ${streamError?.message ?? "no stream"}`)
            }
            const chunks: Buffer[] = []
            for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            out.push({ base64: Buffer.concat(chunks).toString("base64"), fileName: img.fileName })
          }
          return out
        }

        const [pupilB64, answerB64] = await Promise.all([toBase64(images), toBase64(answerImages)])
        const markingGuidance = await resolveMarkingGuidance(markingGuidanceText, markingGuidanceId)

        await invokeWorksheetMarking({
          submission_id: submissionId,
          activity_id: activityId,
          pupil_id: userId,
          group_assignment_id: groupAssignmentId ?? undefined,
          webhook_url: `${callbackBase}/webhooks/ai-mark`,
          max_marks: maxMarks,
          marking_guidance: markingGuidance,
          pupil_images: pupilB64,
          answer_images: answerB64,
        })
      } catch (err) {
        console.error(`${tag} Worksheet marking invoke failed — setting marking-error`, err)
        try {
          await client.query(
            `update submissions set mark_status = 'marking-error', mark_error = $1 where submission_id = $2`,
            ["Could not send your work for marking. Please try again.", submissionId],
          )
          void emitSubmissionEvent("submission.updated", {
            submissionId,
            activityId,
            pupilId: userId,
            markStatus: "marking-error",
            markError: "Could not send your work for marking. Please try again.",
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
