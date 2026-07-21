"use server"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { invokeWorksheetMarking, type WorksheetMarkingImage } from "@/lib/ai/worksheet-marking-client"
import { MarkWorksheetActivityBodySchema, UploadWorksheetSubmissionBodySchema } from "@/types"

const LESSON_FILES_BUCKET = "lessons"

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
      console.error("[worksheet-remark] Failed to load marking guidance", err)
    }
  }
  if (guidance.trim()) parts.push(guidance.trim())
  return parts.join("\n\n")
}

/**
 * Re-send a pupil's already-uploaded worksheet images to the AI-MARK-WORKSHEET
 * flow, without re-uploading. Reuses the latest submission's images and the
 * activity's worksheet/answer images + guidance. Sets the submission back to
 * `marking` (clearing any prior error).
 */
export async function resendWorksheetForMarkingAction(input: {
  activityId: string
  pupilId: string
  groupAssignmentId?: string
}): Promise<{ success: boolean; error: string | null }> {
  const profile = await getAuthenticatedProfile()
  if (!profile) return { success: false, error: "Unauthorized" }

  const { activityId, pupilId, groupAssignmentId } = input
  if (!activityId || !pupilId) return { success: false, error: "Missing parameters." }
  if (profile.userId !== pupilId && !hasRole(profile, "teacher")) {
    return { success: false, error: "You are not allowed to resend for this pupil." }
  }

  // Latest submission's pupil images.
  const { rows: subRows } = await query<{ submission_id: string; body: unknown }>(
    `select submission_id, body from submissions where activity_id = $1 and user_id = $2 order by attempt_number desc limit 1`,
    [activityId, pupilId],
  )
  const sub = subRows[0]
  if (!sub) return { success: false, error: "No submission to resend." }
  const parsedSub = UploadWorksheetSubmissionBodySchema.safeParse(sub.body)
  const pupilImages: Array<{ filePath: string; fileName: string }> = parsedSub.success
    ? parsedSub.data.images
    : []
  if (pupilImages.length === 0) return { success: false, error: "No uploaded images to resend." }
  const submissionId = sub.submission_id

  // Activity config (worksheet + answer images + guidance + max_marks).
  const { rows: actRows } = await query<{ body_data: unknown; max_marks: number }>(
    `select body_data, coalesce(max_marks, 1) as max_marks from activities where activity_id = $1 limit 1`,
    [activityId],
  )
  const act = actRows[0]
  const maxMarks = Number(act?.max_marks) || 1
  const parsedAct = MarkWorksheetActivityBodySchema.safeParse(act?.body_data)
  const worksheetImages = parsedAct.success ? parsedAct.data.worksheetImages : []
  const answerImages = parsedAct.success ? parsedAct.data.answerImages : []
  const markingGuidanceText = parsedAct.success ? parsedAct.data.markingGuidance : ""
  const markingGuidanceId = parsedAct.success ? parsedAct.data.markingGuidanceId : undefined

  await query(
    `update submissions set mark_status = 'marking', mark_error = null where submission_id = $1`,
    [submissionId],
  )
  void emitSubmissionEvent("submission.updated", { submissionId, activityId, pupilId, markStatus: "marking" })

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const toBase64 = async (
    list: Array<{ filePath: string; fileName: string }>,
  ): Promise<WorksheetMarkingImage[]> => {
    const out: WorksheetMarkingImage[] = []
    for (const img of list) {
      const { stream, error } = await storage.getFileStream(img.filePath)
      if (error || !stream) throw new Error(`Failed to read image at ${img.filePath}`)
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      out.push({ base64: Buffer.concat(chunks).toString("base64"), fileName: img.fileName })
    }
    return out
  }

  try {
    const [pupilB64, answerB64, worksheetB64] = await Promise.all([
      toBase64(pupilImages),
      toBase64(answerImages),
      toBase64(worksheetImages),
    ])
    const markingGuidance = await resolveMarkingGuidance(markingGuidanceText, markingGuidanceId)
    const callbackBase = (process.env.AI_MARKING_CALLBACK_URL ?? "").replace(/\/$/, "")

    await invokeWorksheetMarking({
      submission_id: submissionId,
      activity_id: activityId,
      pupil_id: pupilId,
      group_assignment_id: groupAssignmentId,
      webhook_url: `${callbackBase}/webhooks/ai-mark`,
      max_marks: maxMarks,
      marking_guidance: markingGuidance,
      worksheet_images: worksheetB64,
      answer_images: answerB64,
      pupil_images: pupilB64,
    })
    return { success: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not resend your work for marking."
    console.error("[worksheet-remark] resend failed", err)
    try {
      await query(
        `update submissions set mark_status = 'marking-error', mark_error = $1 where submission_id = $2`,
        [message, submissionId],
      )
      void emitSubmissionEvent("submission.updated", {
        submissionId,
        activityId,
        pupilId,
        markStatus: "marking-error",
        markError: message,
      })
    } catch (updateErr) {
      console.error("[worksheet-remark] Failed to set marking-error", updateErr)
    }
    return { success: false, error: message }
  }
}
