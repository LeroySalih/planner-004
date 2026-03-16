"use client"

const FEEDBACK_REFRESH_EVENT = "planner:feedback-refresh"
const MARKING_COMPLETE_EVENT = "planner:marking-complete"

interface MarkingCompleteDetail {
  activityId: string
  pupilId: string
}

export function triggerMarkingComplete(activityId: string, pupilId: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<MarkingCompleteDetail>(MARKING_COMPLETE_EVENT, { detail: { activityId, pupilId } }))
}

export function addMarkingCompleteListener(
  handler: (activityId: string, pupilId: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {}
  const listener = (event: Event) => {
    const { activityId, pupilId } = (event as CustomEvent<MarkingCompleteDetail>).detail
    handler(activityId, pupilId)
  }
  window.addEventListener(MARKING_COMPLETE_EVENT, listener as EventListener)
  return () => window.removeEventListener(MARKING_COMPLETE_EVENT, listener as EventListener)
}

interface FeedbackRefreshDetail {
  lessonId?: string | null
}

export function triggerFeedbackRefresh(lessonId: string | null | undefined) {
  if (typeof window === "undefined") return
  const detail: FeedbackRefreshDetail = { lessonId: lessonId ?? null }
  window.dispatchEvent(new CustomEvent<FeedbackRefreshDetail>(FEEDBACK_REFRESH_EVENT, { detail }))
}

export function addFeedbackRefreshListener(
  handler: (lessonId: string | null) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {}
  }

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<FeedbackRefreshDetail>
    handler(customEvent.detail?.lessonId ?? null)
  }

  window.addEventListener(FEEDBACK_REFRESH_EVENT, listener as EventListener)

  return () => {
    window.removeEventListener(FEEDBACK_REFRESH_EVENT, listener as EventListener)
  }
}
