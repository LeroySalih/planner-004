import type { SseEventEnvelope, SseTopic } from "./types"

// Who may receive an SSE event. The hub used to send every event on a topic to
// every signed-in client, so a pupil's browser received every other pupil's
// marks, feedback and answers. Staff still receive everything (results
// dashboards, queue, flashcard monitors and authoring pages need it); a pupil
// receives only events about themselves, plus the few class-wide events that
// name no pupil (a feedback release).

export type SseViewer = {
  userId: string
  /** Teachers, admins and technicians. */
  isStaff: boolean
}

const STAFF_ROLES = ["teacher", "admin", "technician"]

export function sseViewerFor(profile: { userId: string; roles: string[] }): SseViewer {
  return {
    userId: profile.userId,
    isStaff: profile.roles.some((role) => STAFF_ROLES.includes(role.toLowerCase())),
  }
}

// Topics a pupil's pages listen to. Authoring (lessons, units), uploads,
// prototypes and test topics are staff-only.
const PUPIL_TOPICS = new Set<SseTopic>(["assignments", "submissions", "flashcards"])

// Topics where every event concerns one pupil. An event there that names no
// pupil is not shown to pupils at all.
const PER_PUPIL_TOPICS = new Set<SseTopic>(["submissions", "flashcards"])

/** The pupil an event is about, from the field names the emitters use. */
function eventPupilId(payload: Record<string, unknown>): string | null {
  for (const key of ["pupilId", "pupil_id", "userId", "user_id"]) {
    const value = payload[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return null
}

export function viewerMayReceive(viewer: SseViewer, event: Pick<SseEventEnvelope, "topic" | "payload">): boolean {
  if (viewer.isStaff) return true
  if (!PUPIL_TOPICS.has(event.topic)) return false
  const pupilId = eventPupilId(event.payload ?? {})
  if (pupilId) return pupilId === viewer.userId
  return !PER_PUPIL_TOPICS.has(event.topic)
}
