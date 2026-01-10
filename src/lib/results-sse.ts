import { emitAssignmentEvent } from "@/lib/sse/topics"
import type { SseEventPayload } from "@/lib/sse/types"

export type AssignmentResultsRealtimePayload = {
  submissionId: string | null
  pupilId: string
  activityId: string
  aiScore: number | null
  aiFeedback: string | null
  successCriteriaScores: Record<string, number>
  isFlagged?: boolean
}

export type AssignmentFeedbackVisibilityPayload = {
  assignmentId: string
  feedbackVisible: boolean
}

export async function publishAssignmentResultsEvents(
  assignmentId: string,
  events: AssignmentResultsRealtimePayload[],
) {
  if (!events?.length) return
  await Promise.all(
    events.map((payload) =>
      emitAssignmentEvent("assignment.results.updated", { assignmentId, ...payload } as SseEventPayload),
    ),
  )
}

export async function publishAssignmentFeedbackVisibilityUpdate(
  payload: AssignmentFeedbackVisibilityPayload,
) {
  await emitAssignmentEvent("assignment.feedback.visibility", payload)
}
