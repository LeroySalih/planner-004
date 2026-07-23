"use server"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import { UploadWorksheetSubmissionBodySchema } from "@/types"

/**
 * Re-send a pupil's latest worksheet submission for AI marking by enqueueing it
 * on the shared marking queue (the single pathway — the queue processor reads
 * the stored pupil + teacher images and calls the ai-mark-worksheet flow). No
 * re-upload: it reuses the latest submission's already-stored images.
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
  // Fall back to a synthetic id when there is no assignment (pupil viewing the
  // lesson directly). Must not be "revision" (that routes the callback to the
  // revision webhook) but must decode ("__") so the ai-mark webhook applies it.
  const markingAssignmentId = groupAssignmentId ?? "self__study"

  // Latest submission — must exist and have uploaded images.
  const { rows: subRows } = await query<{ submission_id: string; body: unknown }>(
    `select submission_id, body from submissions where activity_id = $1 and user_id = $2 order by attempt_number desc limit 1`,
    [activityId, pupilId],
  )
  const sub = subRows[0]
  if (!sub) return { success: false, error: "No submission to resend." }
  const parsedSub = UploadWorksheetSubmissionBodySchema.safeParse(sub.body)
  if (!parsedSub.success || parsedSub.data.images.length === 0) {
    return { success: false, error: "No uploaded images to resend." }
  }
  const submissionId = sub.submission_id

  try {
    await enqueueMarkingTasks(markingAssignmentId, [{ submissionId }])
    void triggerQueueProcessor()
    void emitSubmissionEvent("submission.updated", { submissionId, activityId, pupilId, markStatus: "waiting" })
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
