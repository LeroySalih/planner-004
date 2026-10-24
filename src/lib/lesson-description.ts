// A lesson's description (migration 124): one short sentence for pupils on
// what they will achieve. Shared by the lesson sidebar and the MCP server so
// both apply the same limit as the database.

export const LESSON_DESCRIPTION_MAX = 300

/** Trimmed, or null when empty; throws when longer than the limit. */
export function cleanLessonDescription(description: string): string | null {
  const trimmed = description.trim()
  if (trimmed.length > LESSON_DESCRIPTION_MAX) {
    throw new Error(
      `Lesson description is ${trimmed.length} characters; keep it to one short sentence (at most ${LESSON_DESCRIPTION_MAX})`,
    )
  }
  return trimmed || null
}
