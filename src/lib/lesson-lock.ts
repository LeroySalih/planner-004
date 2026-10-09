import { getAuthenticatedProfile } from '@/lib/auth'
import { query } from '@/lib/db'
import { STAFF_ROLE_IDS } from '@/lib/roles/pupil-membership'

// A locked lesson (migration 111) is read-only for pupils: they can open it
// but cannot change an answer, upload a file or download one. The rule itself
// is the SQL function pupil_lesson_locked; these helpers are the server-side
// gate every pupil write, upload and download path calls. Hiding controls in
// the browser is not enough — an open page could still submit.
//
// Staff are never locked out: a teacher previewing or marking a locked lesson
// must still be able to work in it.

export const LESSON_LOCKED_MESSAGE = 'This lesson is locked by your teacher. You can view it but not change it.'

export class LessonLockedError extends Error {
  constructor() {
    super(LESSON_LOCKED_MESSAGE)
    this.name = 'LessonLockedError'
  }
}

/** Whether `lessonId` is locked for `userId`. Always false for staff. */
export async function isLessonLockedForUser(userId: string, lessonId: string): Promise<boolean> {
  const { rows } = await query<{ locked: boolean }>(
    `select pupil_lesson_locked($1, $2)
            and not exists (select 1 from user_roles ur
                             where ur.user_id = $1 and ur.role_id = any($3::text[])) as locked`,
    [userId, lessonId, [...STAFF_ROLE_IDS]],
  )
  return rows[0]?.locked === true
}

/** Whether the lesson holding `activityId` is locked for `userId`. */
export async function isActivityLockedForUser(userId: string, activityId: string): Promise<boolean> {
  const { rows } = await query<{ lesson_id: string | null }>(
    'select lesson_id from activities where activity_id = $1',
    [activityId],
  )
  const lessonId = rows[0]?.lesson_id
  return lessonId ? isLessonLockedForUser(userId, lessonId) : false
}

/** Throws LessonLockedError when the activity's lesson is locked for the user. */
export async function assertActivityUnlocked(userId: string, activityId: string): Promise<void> {
  if (await isActivityLockedForUser(userId, activityId)) throw new LessonLockedError()
}

/** Throws LessonLockedError when the lesson is locked for the user. */
export async function assertLessonUnlocked(userId: string, lessonId: string): Promise<void> {
  if (await isLessonLockedForUser(userId, lessonId)) throw new LessonLockedError()
}

/**
 * The gate for every write to a pupil's work: throws LessonLockedError when
 * the activity's lesson is locked for `pupilId` — unless the person signed in
 * is staff (a teacher editing, marking or re-sending a pupil's work).
 *
 * Checks the pupil whose work is written, so it holds even where an action
 * takes the user id from the client.
 */
export async function assertCanChangePupilWork(pupilId: string, activityId: string): Promise<void> {
  const profile = await getAuthenticatedProfile()
  if (profile && STAFF_ROLE_IDS.some((role) => profile.roles.includes(role))) return
  if (await isActivityLockedForUser(pupilId, activityId)) throw new LessonLockedError()
}

/** As assertCanChangePupilWork, for paths that know the lesson rather than an activity. */
export async function assertCanChangePupilLesson(pupilId: string, lessonId: string): Promise<void> {
  const profile = await getAuthenticatedProfile()
  if (profile && STAFF_ROLE_IDS.some((role) => profile.roles.includes(role))) return
  if (await isLessonLockedForUser(pupilId, lessonId)) throw new LessonLockedError()
}

/** The lock message when the pupil's work may not be changed, else null. For actions that return errors. */
export async function pupilWorkLockedMessage(pupilId: string, activityId: string): Promise<string | null> {
  try {
    await assertCanChangePupilWork(pupilId, activityId)
    return null
  } catch (error) {
    if (error instanceof LessonLockedError) return error.message
    throw error
  }
}

/** As pupilWorkLockedMessage, for paths that know the lesson rather than an activity. */
export async function pupilLessonLockedMessage(pupilId: string, lessonId: string): Promise<string | null> {
  try {
    await assertCanChangePupilLesson(pupilId, lessonId)
    return null
  } catch (error) {
    if (error instanceof LessonLockedError) return error.message
    throw error
  }
}
