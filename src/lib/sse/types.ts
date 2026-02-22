export const SSE_TOPICS = [
  "assignments",
  "submissions",
  "feedback",
  "uploads",
  "lessons",
  "units",
  "fast-ui",
  "flashcards",
  "test-sse",
] as const

export type SseTopic = (typeof SSE_TOPICS)[number]

export type SseEventPayload = Record<string, unknown>

export type SseEventEnvelope = {
  id: string
  topic: SseTopic
  type: string
  payload: SseEventPayload
  emittedBy: string | null
  createdAt: string
}

export type SseEmitInput = {
  topic: SseTopic
  type: string
  payload: SseEventPayload
  emittedBy?: string | null
}

export type SsePersistedEvent = Omit<SseEventEnvelope, "createdAt" | "id"> & {
  id?: string
  createdAt?: string
}
