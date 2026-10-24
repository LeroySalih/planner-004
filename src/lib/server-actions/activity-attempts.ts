"use server"

import { query } from "@/lib/db"
import { requireAuthenticatedProfile, requireRole } from "@/lib/auth"
import { effectiveCriterionFeedback } from "@/lib/scoring/aggregate-sc-marks"

export type AttemptCriterion = {
  successCriteriaId: string
  description: string
  awarded: number
  available: number
  feedback: string | null
}

export type ActivityAttempt = {
  submissionId: string
  attemptNumber: number
  submittedAt: string | null
  /** A short-text or long-text answer, when the attempt has one. */
  answer: string | null
  /** Null while the attempt is not yet marked. */
  marks: number | null
  maxMarks: number
  /** The teacher's comment if any, else the AI's. */
  feedback: string | null
  criteria: AttemptCriterion[]
}

/**
 * Every attempt a pupil has made at one activity, newest first, with the mark
 * and feedback each received. Each save of an answer is a new attempt, and
 * the earlier ones keep their marks (submission_sc_marks is per submission),
 * so a pupil can see how their score changed. A pupil reads their own; a
 * teacher can read any pupil's.
 */
export async function readActivityAttemptsAction(
  activityId: string,
  pupilId?: string,
): Promise<{ data: ActivityAttempt[] | null; error: string | null }> {
  const profile = await requireAuthenticatedProfile()
  const targetPupilId = pupilId ?? profile.userId
  if (targetPupilId !== profile.userId) await requireRole("teacher")

  try {
    const { rows } = await query<{
      submission_id: string
      attempt_number: number | null
      submitted_at: Date | null
      answer: string | null
      score: number | null
      marks: number | null
      max_marks: number
      teacher_feedback: string | null
      ai_feedback: string | null
    }>(
      `select s.submission_id, s.attempt_number, s.submitted_at,
              s.body::jsonb ->> 'answer' as answer,
              compute_submission_base_score(s.body::jsonb, a.type) as score,
              compute_submission_marks(s.body::jsonb, a.type, coalesce(a.max_marks, 1)) as marks,
              coalesce(a.max_marks, 1) as max_marks,
              s.body::jsonb ->> 'teacher_feedback' as teacher_feedback,
              s.body::jsonb ->> 'ai_model_feedback' as ai_feedback
         from submissions s
         join activities a on a.activity_id = s.activity_id
        where s.activity_id = $1 and s.user_id = $2
        order by s.attempt_number desc nulls last, s.submitted_at desc nulls last, s.submission_id desc`,
      [activityId, targetPupilId],
    )
    if (rows.length === 0) return { data: [], error: null }

    const { rows: criteria } = await query<{
      submission_id: string
      success_criteria_id: string
      description: string | null
      awarded: number
      available: number
      feedback: string | null
      teacher_feedback: string | null
      provenance: string
    }>(
      `select m.submission_id, m.success_criteria_id, sc.description,
              m.awarded, m.available, m.feedback, m.teacher_feedback, m.provenance
         from submission_sc_marks m
         join success_criteria sc on sc.success_criteria_id = m.success_criteria_id
        where m.submission_id = any($1::text[])
        order by sc.order_index, sc.success_criteria_id`,
      [rows.map((row) => row.submission_id)],
    )

    const data = rows.map((row) => ({
      submissionId: row.submission_id,
      attemptNumber: row.attempt_number ?? 1,
      submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      answer: row.answer?.trim() ? row.answer : null,
      marks: row.score === null || row.marks === null ? null : Number(row.marks),
      maxMarks: Number(row.max_marks),
      feedback: row.teacher_feedback?.trim() || row.ai_feedback?.trim() || null,
      criteria: criteria
        .filter((criterion) => criterion.submission_id === row.submission_id)
        .map((criterion) => ({
          successCriteriaId: criterion.success_criteria_id,
          description: criterion.description ?? "",
          awarded: Number(criterion.awarded),
          available: Number(criterion.available),
          feedback: effectiveCriterionFeedback(criterion),
        })),
    }))
    return { data, error: null }
  } catch (error) {
    console.error("[activity-attempts] read failed", error)
    return { data: null, error: "Unable to load earlier attempts." }
  }
}
