import { emitSseEvent } from "./hub"
import type { SseEventPayload } from "./types"

export function emitAssignmentEvent(type: string, payload: SseEventPayload, emittedBy?: string | null) {
  return emitSseEvent({ topic: "assignments", type, payload, emittedBy })
}

export function emitSubmissionEvent(type: string, payload: SseEventPayload, emittedBy?: string | null) {
  return emitSseEvent({ topic: "submissions", type, payload, emittedBy })
}

export function emitFeedbackEvent(type: string, payload: SseEventPayload, emittedBy?: string | null) {
  return emitSseEvent({ topic: "feedback", type, payload, emittedBy })
}

export function emitUploadEvent(type: string, payload: SseEventPayload, emittedBy?: string | null) {
  return emitSseEvent({ topic: "uploads", type, payload, emittedBy })
}

export function emitLessonEvent(type: string, payload: SseEventPayload, emittedBy?: string | null) {
  return emitSseEvent({ topic: "lessons", type, payload, emittedBy })
}

export function emitUnitEvent(type: string, payload: SseEventPayload, emittedBy?: string | null) {
  return emitSseEvent({ topic: "units", type, payload, emittedBy })
}

export function emitFastUiEvent(type: string, payload: SseEventPayload, emittedBy?: string | null) {
  return emitSseEvent({ topic: "fast-ui", type, payload, emittedBy })
}
