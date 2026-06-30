import { NextResponse } from "next/server"
import { z } from "zod"
import { Client } from "pg"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { logActivitySubmissionEvent } from "@/lib/activity-logging"
import { clearResubmitRequest, getNextAttemptNumber } from "@/lib/server-actions/submission-attempts"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

const UploadedFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number().optional(),
  status: z.enum(["inprogress", "submitted"]).default("inprogress"),
  instructions: z.string().nullable().optional(),
  uploaded_at: z.string().optional(),
})

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
  const tag = `[pupil-upload:${requestId}]`

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
  const pupilId = formData.get("pupilId")
  const file = formData.get("file")

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    console.warn(`${tag} Missing lessonId`)
    return NextResponse.json({ success: false, error: "Missing lessonId" }, { status: 400 })
  }
  if (typeof activityId !== "string" || activityId.trim() === "") {
    console.warn(`${tag} Missing activityId`)
    return NextResponse.json({ success: false, error: "Missing activityId" }, { status: 400 })
  }
  if (typeof pupilId !== "string" || pupilId.trim() === "") {
    console.warn(`${tag} Missing pupilId`)
    return NextResponse.json({ success: false, error: "Missing pupilId" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    console.warn(`${tag} No file in request`)
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }

  if (profile.userId !== pupilId && !hasRole(profile, "teacher")) {
    console.warn(`${tag} Auth mismatch: session=${profile.userId} requested pupilId=${pupilId}`)
    return NextResponse.json({ success: false, error: "You are not allowed to upload files for this pupil." }, { status: 403 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    console.warn(`${tag} File too large: ${file.size} bytes (limit ${MAX_FILE_SIZE_BYTES})`, {
      fileName: file.name,
      lessonId,
      activityId,
      pupilId,
    })
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit" }, { status: 413 })
  }

  const userId = pupilId
  const uploaderId = profile.userId
  const fileName = file.name

  console.log(`${tag} Uploading file`, {
    fileName,
    fileSize: file.size,
    fileType: file.type || "unknown",
    lessonId,
    activityId,
    pupilId,
  })

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

  const { error: uploadError } = await storage.upload(path, arrayBuffer, {
    contentType: file.type || "application/octet-stream",
    uploadedBy: uploaderId,
    originalPath: path,
  })

  if (uploadError) {
    console.error(`${tag} Storage upload failed`, { path, error: uploadError.message })
    return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
  }

  console.log(`${tag} Storage upload succeeded`, { path, durationMs: Date.now() - startedAt })

  const submittedAt = new Date().toISOString()
  let submissionId: string | null = null
  const client = createPgClient()

  try {
    await client.connect()

    try {
      const { rows: existingRows } = await client.query(
        `
          select submission_id, body
          from submissions
          where activity_id = $1 and user_id = $2
          order by attempt_number desc
          limit 1
        `,
        [activityId, userId],
      )

      const existing = existingRows[0]
      let uploadedFiles: z.infer<typeof UploadedFileSchema>[] = []

      if (existing?.body) {
        const body = existing.body
        if (Array.isArray(body.uploaded_files)) {
          uploadedFiles = body.uploaded_files
        } else if (body.upload_file_name) {
          uploadedFiles.push({
            name: body.upload_file_name,
            path: "",
            status: "inprogress",
            instructions: body.instructions || null,
            uploaded_at: existing.submitted_at?.toISOString() ?? new Date().toISOString(),
          })
        }
      }

      const duplicateIndex = uploadedFiles.findIndex((f) => f.name === fileName)

      if (duplicateIndex !== -1) {
        const oldFile = uploadedFiles[duplicateIndex]
        const pad = (n: number) => n.toString().padStart(2, "0")
        const now = new Date()
        const timestamp = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${now.getMilliseconds().toString().padStart(3, "0")}`
        const dotIndex = oldFile.name.lastIndexOf(".")
        const versionedName =
          dotIndex === -1
            ? `${oldFile.name}_${timestamp}`
            : `${oldFile.name.slice(0, dotIndex)}_${timestamp}${oldFile.name.slice(dotIndex)}`

        const oldPath = oldFile.path || buildSubmissionPath(lessonId, activityId, pupilStorageKey, oldFile.name)
        const newVersionedPath = buildSubmissionPath(lessonId, activityId, pupilStorageKey, versionedName)

        console.log(`${tag} Versioning duplicate file`, { oldPath, newVersionedPath })
        const { error: moveError } = await storage.move(oldPath, newVersionedPath)
        if (moveError) {
          console.error(`${tag} Failed to move old version`, { oldPath, newVersionedPath, error: moveError.message })
        }

        uploadedFiles[duplicateIndex] = { ...oldFile, name: versionedName, path: newVersionedPath }
      }

      uploadedFiles.unshift({
        name: fileName,
        path,
        size: file.size,
        status: "inprogress",
        instructions: null,
        uploaded_at: submittedAt,
      })

      const submissionPayload = {
        submission_type: "upload-file",
        upload_submission: true,
        uploaded_files: uploadedFiles,
        upload_file_name: fileName,
        upload_updated_at: submittedAt,
        success_criteria_scores: {},
      }

      const attemptNumber = await getNextAttemptNumber(activityId, userId)
      const { rows: newRows } = await client.query(
        `
          insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status)
          values ($1, $2, $3, $4, $5, 'inprogress')
          returning submission_id
        `,
        [activityId, userId, attemptNumber, submissionPayload, submittedAt],
      )
      submissionId = newRows[0]?.submission_id ?? null
      console.log(`${tag} Created new attempt`, { submissionId, attemptNumber })

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
    await emitSubmissionEvent("submission.uploaded", {
      submissionId,
      activityId,
      pupilId: userId,
      submittedAt,
      fileName,
      submissionStatus: "inprogress",
      isFlagged: false,
    })
  } catch (err) {
    console.error(`${tag} SSE emit failed (non-fatal)`, err)
  }

  const totalMs = Date.now() - startedAt
  console.log(`${tag} Upload complete`, { submissionId, fileName, lessonId, activityId, pupilId, totalMs })

  return NextResponse.json({ success: true })
}
