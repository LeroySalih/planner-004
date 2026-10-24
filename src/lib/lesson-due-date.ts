import { addDays, format, parseISO } from "date-fns"

// A lesson is due a week after the class has it: the rule My Units has always
// used, and the lesson page and its course list use the same. The SQL in
// pupil-lesson-article-data.ts mirrors it as start_date + DUE_AFTER_DAYS.
export const DUE_AFTER_DAYS = 7

/** The due date (yyyy-MM-dd) for a lesson on `startDate`, or null without one. */
export function lessonDueDate(startDate: string | null | undefined): string | null {
  if (!startDate) return null
  try {
    return format(addDays(parseISO(startDate.slice(0, 10)), DUE_AFTER_DAYS), "yyyy-MM-dd")
  } catch {
    return null
  }
}
