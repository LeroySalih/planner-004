"use client"

const FEEDBACK_REFRESH_EVENT = "planner:feedback-refresh"

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
