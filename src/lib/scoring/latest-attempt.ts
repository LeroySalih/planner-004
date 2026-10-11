/**
 * The one rule for which attempt counts: a pupil's score on an activity is
 * always their LATEST attempt — highest attempt_number, then the newest
 * submitted_at. Earlier attempts stay in `submissions` for audit, but no score,
 * mark, percentage or average may use them, or divide by how many there are.
 *
 * SQL uses the same order:
 *   distinct on (activity_id, user_id) … order by activity_id, user_id,
 *     attempt_number desc, submitted_at desc nulls last, submission_id desc
 */

type Attempt = {
  activity_id: string
  user_id: string
  attempt_number?: number | null
  submitted_at?: string | Date | null
  submission_id?: string | null
}

function isLater(candidate: Attempt, current: Attempt): boolean {
  const attemptDiff = (candidate.attempt_number ?? 0) - (current.attempt_number ?? 0)
  if (attemptDiff !== 0) return attemptDiff > 0
  const candidateTime = candidate.submitted_at ? new Date(candidate.submitted_at).getTime() : 0
  const currentTime = current.submitted_at ? new Date(current.submitted_at).getTime() : 0
  if (candidateTime !== currentTime) return candidateTime > currentTime
  return (candidate.submission_id ?? '') > (current.submission_id ?? '')
}

/** Keeps only each pupil's latest attempt per activity, in no particular order. */
export function latestAttempts<T extends Attempt>(submissions: T[]): T[] {
  const latest = new Map<string, T>()
  for (const submission of submissions) {
    const key = `${submission.activity_id}\u0000${submission.user_id}`
    const current = latest.get(key)
    if (!current || isLater(submission, current)) latest.set(key, submission)
  }
  return Array.from(latest.values())
}
