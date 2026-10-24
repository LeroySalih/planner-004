'use server'

import { unstable_rethrow } from 'next/navigation'

import { requireAuthenticatedProfile } from '@/lib/auth'
import { withDbClient } from '@/lib/db'
import {
  LessonUnderstandingError,
  readLessonUnderstanding,
  recordLessonUnderstanding,
  type LessonUnderstanding,
  type UnderstandingRating,
} from '@/lib/lesson-understanding/store'

/**
 * A pupil's thumbs up or down on a lesson, always recorded as the signed-in
 * pupil: there is no pupil id to pass, so no one can answer for someone else.
 * Teachers previewing the page cannot answer.
 */
export async function recordLessonUnderstandingAction(
  lessonId: string,
  rating: UnderstandingRating,
): Promise<{ data: LessonUnderstanding | null; error: string | null }> {
  try {
    const profile = await requireAuthenticatedProfile()
    if (profile.isTeacher) return { data: null, error: 'Only pupils answer this.' }
    const data = await withDbClient((client) => recordLessonUnderstanding(client, profile.userId, lessonId, rating))
    return { data, error: null }
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof LessonUnderstandingError) return { data: null, error: error.message }
    console.error('[lesson-understanding] record failed', error)
    return { data: null, error: 'Could not save your answer. Please try again.' }
  }
}

/**
 * The current answer, read fresh: a page restored from the browser's history
 * would otherwise show the answer as it was when that page was first loaded.
 * A pupil reads their own; a teacher can read any pupil's.
 */
export async function readLessonUnderstandingAction(
  lessonId: string,
  pupilId: string,
): Promise<{ data: LessonUnderstanding | null; error: string | null }> {
  try {
    const profile = await requireAuthenticatedProfile()
    if (!profile.isTeacher && profile.userId !== pupilId) return { data: null, error: 'Not allowed.' }
    return { data: await withDbClient((client) => readLessonUnderstanding(client, pupilId, lessonId)), error: null }
  } catch (error) {
    unstable_rethrow(error)
    console.error('[lesson-understanding] read failed', error)
    return { data: null, error: 'Could not load your answer.' }
  }
}
