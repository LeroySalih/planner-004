import { NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { getActivityLessonId, logActivitySubmissionEvent } from "@/lib/activity-logging"
import { fetchActivitySuccessCriteriaIds, normaliseSuccessCriteriaScores } from "@/lib/scoring/success-criteria"
import { SketchRenderSubmissionBodySchema, SubmissionSchema } from "@/types"
import { clearResubmitRequest, getNextAttemptNumber } from "@/lib/server-actions/submission-attempts"

async function resolvePupilStorageKey(userId: string): Promise<string> {
  const { rows } = await query<{ email: string | null }>(
    `select email from profiles where user_id = $1 limit 1`,
    [userId],
  )
  const email = rows[0]?.email?.trim()
  return email && email.length > 0 ? email : userId
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[sketch-render-save:${requestId}]`
  const startedAt = Date.now()

  console.log(`${tag} Request received`)

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    console.warn(`${tag} Rejected: unauthenticated`)
    return NextResponse.json({ success: false, error: "Unauthorized", data: null }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error(`${tag} Failed to parse form data`, err)
    return NextResponse.json({ success: false, error: "Invalid request body", data: null }, { status: 400 })
  }

  const activityId = formData.get("activityId")
  const userId = formData.get("userId")
  const prompt = formData.get("prompt")
  const originalFile = formData.get("originalFile")

  if (typeof activityId !== "string" || activityId.trim() === "") {
    console.warn(`${tag} Missing activityId`)
    return NextResponse.json({ success: false, error: "Missing activityId", data: null }, { status: 400 })
  }
  if (typeof userId !== "string" || userId.trim() === "") {
    console.warn(`${tag} Missing userId`)
    return NextResponse.json({ success: false, error: "Missing userId", data: null }, { status: 400 })
  }

  if (profile.userId !== userId) {
    console.warn(`${tag} Auth mismatch: session=${profile.userId} requested userId=${userId}`)
    return NextResponse.json({ success: false, error: "Unauthorized", data: null }, { status: 403 })
  }

  console.log(`${tag} Saving sketch`, {
    activityId,
    userId,
    hasFile: originalFile instanceof File && originalFile.size > 0,
    promptLength: typeof prompt === "string" ? prompt.length : 0,
  })

  const lessonId = await getActivityLessonId(activityId)
  if (!lessonId) {
    console.error(`${tag} lessonId not found for activityId`, { activityId })
    return NextResponse.json({ success: false, error: "Configuration error: Lesson ID missing", data: null }, { status: 500 })
  }

  const rawEmail = profile.email?.trim()
  const storageKey = rawEmail && rawEmail.length > 0 ? rawEmail : await resolvePupilStorageKey(userId)
  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(activityId)
  const initialScores = normaliseSuccessCriteriaScores({ successCriteriaIds, fillValue: 0 })

  let originalFilePath: string | null = null
  if (originalFile instanceof File && originalFile.size > 0) {
    try {
      const storage = createLocalStorageClient("lessons")
      const fileName = `sketch_original_${Date.now()}_${originalFile.name}`
      const path = `lessons/${lessonId}/activities/${activityId}/${storageKey}/${fileName}`
      let buffer: ArrayBuffer
      try {
        buffer = await originalFile.arrayBuffer()
      } catch (err) {
        console.error(`${tag} Failed to read sketch file buffer`, err)
        return NextResponse.json({ success: false, error: "Failed to read sketch image", data: null }, { status: 500 })
      }
      const { error } = await storage.upload(path, Buffer.from(buffer))
      if (error) throw new Error(error.message)
      originalFilePath = fileName
      console.log(`${tag} Original file uploaded`, { path, durationMs: Date.now() - startedAt })
    } catch (err) {
      console.error(`${tag} Failed to upload original sketch file`, err)
      return NextResponse.json({ success: false, error: "Failed to upload sketch image", data: null }, { status: 500 })
    }
  }

  let existingSubmission = null
  try {
    const { rows } = await query(
      `select * from submissions where activity_id = $1 and user_id = $2 order by attempt_number desc limit 1`,
      [activityId, userId],
    )
    existingSubmission = rows[0] ? SubmissionSchema.parse(rows[0]) : null
  } catch {
    // treat as no existing submission
  }

  const existingBody = existingSubmission ? SketchRenderSubmissionBodySchema.safeParse(existingSubmission.body).data : null
  const finalOriginalPath = originalFilePath ?? existingBody?.original_file_path ?? null
  const finalRenderedPath = existingBody?.rendered_file_path ?? null

  const submissionBody = SketchRenderSubmissionBodySchema.parse({
    prompt: (typeof prompt === "string" ? prompt : "").trim(),
    original_file_path: finalOriginalPath,
    rendered_file_path: finalRenderedPath,
    ai_model_score: existingBody?.ai_model_score ?? null,
    ai_model_feedback: existingBody?.ai_model_feedback ?? null,
    teacher_override_score: existingBody?.teacher_override_score ?? null,
    is_correct: existingBody?.is_correct ?? false,
    success_criteria_scores: existingBody?.success_criteria_scores ?? initialScores,
  })

  const timestamp = new Date().toISOString()
  let saved: Record<string, unknown> | undefined

  try {
    const attemptNumber = await getNextAttemptNumber(activityId, userId)
    const result = await query(
      `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, is_flagged) values ($1, $2, $3, $4, $5, false) returning *`,
      [activityId, userId, attemptNumber, submissionBody, timestamp],
    )
    saved = result.rows[0] as Record<string, unknown>
    await clearResubmitRequest(activityId, userId)
  } catch (err) {
    console.error(`${tag} DB upsert failed`, err)
    return NextResponse.json({ success: false, error: "Failed to save submission", data: null }, { status: 500 })
  }

  if (!saved) {
    return NextResponse.json({ success: false, error: "Failed to save", data: null }, { status: 500 })
  }

  const submissionId = saved.submission_id as string
  const submittedAt = (saved.submitted_at as string) ?? timestamp

  void logActivitySubmissionEvent({
    submissionId,
    activityId,
    lessonId,
    pupilId: userId,
    fileName: submissionBody.original_file_path ?? null,
    submittedAt,
  })

  void emitSubmissionEvent("submission.updated", {
    submissionId,
    activityId,
    pupilId: userId,
    submittedAt,
    submissionStatus: "inprogress",
    isFlagged: false,
  })

  const totalMs = Date.now() - startedAt
  console.log(`${tag} Complete`, { submissionId, activityId, totalMs })

  return NextResponse.json({ success: true, data: saved })
}
