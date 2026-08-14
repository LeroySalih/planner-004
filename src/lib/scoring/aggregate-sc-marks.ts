import "server-only"

import { query, withDbClient } from "@/lib/db"
import { computeScAggregate } from "@/lib/scoring/client-success-criteria"

const SHORT_TEXT_CORRECTNESS_THRESHOLD = 0.8

/**
 * The comment to show for a criterion.
 *
 * A teacher's comment always wins. When a teacher has changed the MARK but not
 * written a comment, the AI's comment is suppressed rather than shown: it
 * explains a mark that no longer stands ("You earned 2 marks..." under a 3/3
 * is worse than no explanation at all).
 */
export function effectiveCriterionFeedback(row: {
  feedback: string | null
  teacher_feedback: string | null
  provenance: string
}): string | null {
  const teacher = row.teacher_feedback?.trim()
  if (teacher) return teacher
  if (row.provenance === "teacher") return null
  const ai = row.feedback?.trim()
  return ai && ai.length > 0 ? ai : null
}

export interface CriterionMarkInput {
  submissionId: string
  activityId: string
  successCriteriaId: string
  awarded: number
  available: number
  feedback: string | null
}

export interface CriterionMarkOutcome {
  /** True once every criterion on the activity has a mark and the aggregate was written. */
  complete: boolean
  recorded: number
  expected: number
  aggregate: { normalised: number; awarded: number; available: number } | null
}

/**
 * Record one criterion's mark and, if it completes the set, write the
 * submission's aggregate score.
 *
 * Concurrency: processNextQueueItem runs a batch through Promise.allSettled, so
 * two criterion callbacks for the SAME submission routinely arrive together.
 * Both would read the same completed-count and either both skip the aggregate
 * or both write it. The `select ... for update` on the submission row
 * serialises them: the second waits, then sees the first's row and completes.
 *
 * Idempotency: the upsert replays cleanly, and rows a teacher has overridden
 * are never overwritten — their marks are authoritative (Q7).
 */
export async function recordCriterionMark(
  input: CriterionMarkInput,
): Promise<CriterionMarkOutcome> {
  return withDbClient(async (client) => {
    await client.query("BEGIN")
    try {
      await client.query(
        `insert into submission_sc_marks
           (submission_id, success_criteria_id, awarded, available, feedback, provenance, marked_at)
         values ($1, $2, $3, $4, $5, 'ai', timezone('utc', now()))
         on conflict (submission_id, success_criteria_id) do update
           set awarded = excluded.awarded,
               available = excluded.available,
               feedback = excluded.feedback,
               provenance = 'ai',
               marked_at = excluded.marked_at
           where submission_sc_marks.provenance <> 'teacher'`,
        [
          input.submissionId,
          input.successCriteriaId,
          input.awarded,
          input.available,
          input.feedback,
        ],
      )

      // Serialise concurrent sibling callbacks for this submission.
      await client.query("select submission_id from submissions where submission_id = $1 for update", [
        input.submissionId,
      ])

      const { rows: expectedRows } = await client.query<{ expected: string }>(
        `select count(*)::text as expected
         from activity_success_criteria
         where activity_id = $1`,
        [input.activityId],
      )
      const expected = Number(expectedRows[0]?.expected ?? 0)

      const { rows: markRows } = await client.query<{
        success_criteria_id: string
        awarded: number
        available: number
        feedback: string | null
        teacher_feedback: string | null
        provenance: string
      }>(
        `select m.success_criteria_id, m.awarded, m.available, m.feedback,
                m.teacher_feedback, m.provenance
         from submission_sc_marks m
         join activity_success_criteria acs
           on acs.success_criteria_id = m.success_criteria_id
          and acs.activity_id = $2
         where m.submission_id = $1
         order by m.success_criteria_id`,
        [input.submissionId, input.activityId],
      )

      const recorded = markRows.length

      if (expected === 0 || recorded < expected) {
        await client.query("COMMIT")
        return { complete: false, recorded, expected, aggregate: null }
      }

      const marks = markRows.map((row) => ({
        awarded: Number(row.awarded),
        available: Number(row.available),
      }))
      const aggregate = computeScAggregate(marks)

      if (!aggregate) {
        await client.query("COMMIT")
        return { complete: false, recorded, expected, aggregate: null }
      }

      // Keep body.success_criteria_scores populated as normalised 0-1 values.
      // The reporting layer (activity-scores.ts, the results dashboard) reads
      // that map directly, so dropping it would blank those views.
      const criterionScores: Record<string, number> = {}
      for (const row of markRows) {
        const available = Number(row.available)
        criterionScores[row.success_criteria_id] = available > 0
          ? Number(row.awarded) / available
          : 0
      }

      const combinedFeedback = markRows
        .map((row) => effectiveCriterionFeedback(row))
        .filter((text): text is string => Boolean(text))
        .join("\n\n")

      // ai_model_score carries the normalised aggregate because that is what
      // compute_submission_base_score reads — every existing report and RPC
      // keeps working without an SQL change. submission_sc_marks stays
      // authoritative; this is a cache.
      await client.query(
        `update submissions
         set body = (
           coalesce(body::jsonb, '{}'::jsonb) || jsonb_build_object(
             'ai_model_score', $2::numeric,
             'ai_marks', $3::int,
             'marks', $3::int,
             'sc_marks_awarded', $3::int,
             'sc_marks_available', $4::int,
             'is_correct', $5::boolean,
             'success_criteria_scores', $6::jsonb,
             'ai_model_feedback', $7::text
           )
         )::json,
         mark_status = 'marked',
         mark_error = null
         where submission_id = $1`,
        [
          input.submissionId,
          aggregate.normalised,
          aggregate.awarded,
          aggregate.available,
          aggregate.normalised >= SHORT_TEXT_CORRECTNESS_THRESHOLD,
          JSON.stringify(criterionScores),
          combinedFeedback.length > 0 ? combinedFeedback : null,
        ],
      )

      await client.query("COMMIT")
      return { complete: true, recorded, expected, aggregate }
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  })
}

/**
 * Propagate a deterministically-scored activity's own outcome to each of its
 * success criteria (Q6b).
 *
 * MCQ, matcher, sequence, group-items and do-flashcards never reach a model, so
 * there is nothing to assess per criterion. `score` is the activity's own
 * result as a 0-1 fraction: right/wrong types pass 1 or 0, while do-flashcards
 * passes correctCount/totalCards. Each criterion is awarded
 * round(score x available).
 *
 * This is uniform fill BY DESIGN and is the one place it remains legitimate: it
 * records which criteria the activity evidences, for coverage reporting. It
 * carries no more information than the activity score itself, and unlike AI
 * marking it never pretends to. The activity's own max_marks stays capped at 1
 * (see derive-max-marks) so extra criteria cannot inflate its weight.
 *
 * Teacher overrides are preserved.
 */
export async function propagateDeterministicScMarks(
  submissionId: string,
  activityId: string,
  score: number,
): Promise<number> {
  const fraction = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0

  const { rows } = await query(
    `insert into submission_sc_marks
       (submission_id, success_criteria_id, awarded, available, feedback, provenance, marked_at)
     select $1,
            acs.success_criteria_id,
            round($3::numeric * criterion.available)::int,
            criterion.available,
            null,
            'ai',
            timezone('utc', now())
     from activity_success_criteria acs
     join success_criteria sc on sc.success_criteria_id = acs.success_criteria_id
     cross join lateral (
       select case when sc.sc_type = 'levelled'
                   then greatest(1, (
                     select count(*) from success_criteria_descriptors d
                     where d.success_criteria_id = sc.success_criteria_id
                   ))
                   else 1
              end::int as available
     ) criterion
     where acs.activity_id = $2
     on conflict (submission_id, success_criteria_id) do update
       set awarded = excluded.awarded,
           available = excluded.available,
           provenance = 'ai',
           marked_at = excluded.marked_at
       where submission_sc_marks.provenance <> 'teacher'
     returning success_criteria_id`,
    [submissionId, activityId, fraction],
  )

  return rows.length
}

/**
 * Recompute and persist a submission's aggregate from its current criterion
 * marks. Used after a teacher edits one criterion (Q7: the total is always the
 * sum of its parts).
 */
export async function recomputeSubmissionAggregate(
  submissionId: string,
  activityId: string,
): Promise<{ normalised: number; awarded: number; available: number } | null> {
  return withDbClient(async (client) => {
    await client.query("BEGIN")
    try {
      await client.query("select submission_id from submissions where submission_id = $1 for update", [
        submissionId,
      ])

      const { rows } = await client.query<{
        success_criteria_id: string
        awarded: number
        available: number
        feedback: string | null
        teacher_feedback: string | null
        provenance: string
      }>(
        `select m.success_criteria_id, m.awarded, m.available, m.feedback,
                m.teacher_feedback, m.provenance
         from submission_sc_marks m
         join activity_success_criteria acs
           on acs.success_criteria_id = m.success_criteria_id
          and acs.activity_id = $2
         where m.submission_id = $1
         order by m.success_criteria_id`,
        [submissionId, activityId],
      )

      const aggregate = computeScAggregate(
        rows.map((row) => ({ awarded: Number(row.awarded), available: Number(row.available) })),
      )

      if (!aggregate) {
        await client.query("COMMIT")
        return null
      }

      const criterionScores: Record<string, number> = {}
      for (const row of rows) {
        const available = Number(row.available)
        criterionScores[row.success_criteria_id] = available > 0
          ? Number(row.awarded) / available
          : 0
      }

      const combinedFeedback = rows
        .map((row) => effectiveCriterionFeedback(row))
        .filter((text): text is string => Boolean(text))
        .join("\n\n")

      await client.query(
        `update submissions
         set body = (
           coalesce(body::jsonb, '{}'::jsonb) || jsonb_build_object(
             'ai_model_score', $2::numeric,
             'ai_marks', $3::int,
             'marks', $3::int,
             'sc_marks_awarded', $3::int,
             'sc_marks_available', $4::int,
             'is_correct', $5::boolean,
             'success_criteria_scores', $6::jsonb,
             'ai_model_feedback', $7::text
           )
         )::json
         where submission_id = $1`,
        [
          submissionId,
          aggregate.normalised,
          aggregate.awarded,
          aggregate.available,
          aggregate.normalised >= SHORT_TEXT_CORRECTNESS_THRESHOLD,
          JSON.stringify(criterionScores),
          combinedFeedback.length > 0 ? combinedFeedback : null,
        ],
      )

      await client.query("COMMIT")
      return aggregate
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  })
}
