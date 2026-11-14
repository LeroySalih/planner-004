import "server-only"

import { query, withDbClient } from "@/lib/db"
import { isAssessmentPaperType, isPowerPointAssessmentType, isQuestionMarkedActivityType } from "@/dino.config"
import { assertScAllowedForActivity, type Queryable } from "@/lib/curriculum/unit-curriculum-guard"
import { recalculateAssessmentPaperMaxMarks } from "@/lib/scoring/derive-max-marks"
import { validateQuestionEvidence, type QuestionEvidence } from "@/lib/powerpoint-assessment/evidence-spec"

// An assessment paper is marked question by question. Each question splits
// its marks across the success criteria it tests (Q3 = 4 -> SC-A 2 + SC-B 2),
// and the marker marks each criterion within the question out of its
// allocation. The question's mark is the sum.
//
//   submission_question_criterion_marks   per (question, criterion): the marks
//   submission_question_marks             per question: Σ of the above
//   submissions.body / submission_sc_marks derived, so every report reads the
//                                          paper like any other activity
//
// Legacy questions (papers folded in from the old assessments module) are the
// exception: the old split is unknown, so the question row holds the old mark
// and every criterion row records that same mark out of the question's marks
// (3/4 -> A 3/4, B 3/4). The question still counts 3/4 once in the total. The
// first AI or teacher mark on a criterion of such a question splits it first
// (splitLegacyQuestion), after which it is an ordinary question.
//
// Migration 132 exempts the type from the per-criterion machinery, which would
// otherwise rewrite these totals from the criteria's own types.

export type QuestionMarkProvenance = "ai" | "teacher" | "legacy"

/**
 * Who marks a question: the model ('ai'), the model then the teacher checks
 * ('ai_check'), or the teacher alone ('teacher', never sent).
 */
export type QuestionMarking = "ai" | "ai_check" | "teacher"
export const QUESTION_MARKINGS: readonly QuestionMarking[] = ["ai", "ai_check", "teacher"]

export type AnswerKind = "text" | "sketch" | "mixed"
export type AnswerStatus = "answered" | "blank" | "unreadable" | "continued"

/** What the reader found for one question on a pupil's script. */
export interface SubmissionQuestionAnswer {
  questionId: string
  kind: AnswerKind
  transcription: string | null
  /** Script page numbers (2..n) the answer is on. */
  pages: number[]
  status: AnswerStatus
  provenance: "ai" | "teacher"
}

export interface SubmissionQuestionAnswerInput {
  questionId: string
  kind: AnswerKind
  transcription: string | null
  pages: number[]
  status: AnswerStatus
  /**
   * A blank answer only: why it is blank, in plain words for the pupil (a
   * PowerPoint assessment's reader says which file, slide or heading was
   * missing). It is the 0's comment instead of NO_ANSWER_COMMENT. Never
   * stored with the answer.
   */
  blankReason?: string
}

/** The comment a blank answer gets with its 0. */
export const NO_ANSWER_COMMENT = "No answer submitted"

export interface AssessmentQuestionCriterion {
  successCriteriaId: string
  /** The criterion's allocation within the question. */
  maxMarks: number
  position: number
}

export interface AssessmentQuestion {
  questionId: string
  label: string
  position: number
  maxMarks: number
  questionText: string | null
  markScheme: string | null
  marking: QuestionMarking
  /** Error carried forward: the earlier question whose answer the marker also sees. */
  dependsOnQuestionId: string | null
  /** PowerPoint assessment: where the question's evidence comes from. Always [] on an assessment paper. */
  evidence: QuestionEvidence[]
  criteria: AssessmentQuestionCriterion[]
}

export interface AssessmentQuestionInput {
  label: string
  maxMarks: number
  questionText?: string | null
  markScheme?: string | null
  /** Omitted: unchanged (a new question gets 'ai'). */
  marking?: QuestionMarking
  /** The label of an earlier question on the paper, or null for none. Omitted: unchanged. */
  dependsOn?: string | null
  /**
   * PowerPoint assessment: the question's evidence sources
   * (src/lib/powerpoint-assessment/evidence-spec.ts). Omitted: unchanged (a
   * new question gets none). An assessment paper takes none.
   */
  evidence?: unknown[]
  criteria: Array<{ successCriteriaId: string; maxMarks: number }>
}

export interface QuestionCriterionMarkInput {
  questionId: string
  successCriteriaId: string
  awarded: number
  whyNotAwarded?: string | null
  howToImprove?: string | null
}

export interface AssessmentSubmissionTotals {
  awarded: number
  available: number
  score: number
}

export async function readAssessmentQuestions(activityId: string): Promise<AssessmentQuestion[]> {
  return readQuestions({ query } as Queryable, activityId)
}

async function readQuestions(db: Queryable, activityId: string): Promise<AssessmentQuestion[]> {
  const { rows } = await db.query<{
    question_id: string
    label: string
    position: number
    max_marks: number
    question_text: string | null
    mark_scheme: string | null
    marking: QuestionMarking
    depends_on_question_id: string | null
    evidence: QuestionEvidence[] | null
    criteria: AssessmentQuestionCriterion[] | null
  }>(
    `select q.question_id, q.label, q.position, q.max_marks, q.question_text, q.mark_scheme,
            q.marking, q.depends_on_question_id, q.evidence,
            (select jsonb_agg(jsonb_build_object(
                      'successCriteriaId', c.success_criteria_id,
                      'maxMarks', c.max_marks,
                      'position', c.position)
                    order by c.position, c.success_criteria_id)
               from activity_question_criteria c
              where c.question_id = q.question_id) as criteria
       from activity_questions q
      where q.activity_id = $1
      order by q.position, q.label`,
    [activityId],
  )
  return rows.map((row) => ({
    questionId: row.question_id,
    label: row.label,
    position: Number(row.position),
    maxMarks: Number(row.max_marks),
    questionText: row.question_text,
    markScheme: row.mark_scheme,
    marking: row.marking,
    dependsOnQuestionId: row.depends_on_question_id,
    evidence: row.evidence ?? [],
    criteria: row.criteria ?? [],
  }))
}

/** True when the submission belongs to a question-marked activity. */
export async function submissionIsQuestionMarked(
  submissionId: string,
  db: Queryable = { query } as Queryable,
): Promise<boolean> {
  const { rows } = await db.query<{ type: string | null }>(
    `select a.type from submissions s join activities a on a.activity_id = s.activity_id
      where s.submission_id = $1`,
    [submissionId],
  )
  return isQuestionMarkedActivityType(rows[0]?.type)
}

function validateQuestions(questions: AssessmentQuestionInput[]): AssessmentQuestionInput[] {
  const seen = new Set<string>()
  return questions.map((question) => {
    const label = question.label?.trim() ?? ""
    if (!label) throw new Error("Every question needs a label.")
    if (seen.has(label)) throw new Error(`Question "${label}" appears twice; labels must be unique.`)

    if (question.marking !== undefined && !QUESTION_MARKINGS.includes(question.marking)) {
      throw new Error(`Question "${label}" has an unknown marking setting: ${JSON.stringify(question.marking)}.`)
    }
    const dependsOn = question.dependsOn === undefined ? undefined : question.dependsOn?.trim() || null
    if (dependsOn !== undefined && dependsOn !== null && !seen.has(dependsOn)) {
      throw new Error(
        dependsOn === label
          ? `Question "${label}" cannot depend on itself.`
          : `Question "${label}" depends on "${dependsOn}", which is not an earlier question on this paper.`,
      )
    }
    seen.add(label)

    if (!Number.isInteger(question.maxMarks) || question.maxMarks < 1) {
      throw new Error(`Question "${label}" must be worth a whole number of marks, at least 1.`)
    }
    if (question.criteria.length === 0) {
      throw new Error(`Question "${label}" must test at least one success criterion.`)
    }

    const criteria = new Set<string>()
    let total = 0
    for (const criterion of question.criteria) {
      if (criteria.has(criterion.successCriteriaId)) {
        throw new Error(`Question "${label}" lists a success criterion twice.`)
      }
      criteria.add(criterion.successCriteriaId)
      if (!Number.isInteger(criterion.maxMarks) || criterion.maxMarks < 1) {
        throw new Error(`Each criterion on question "${label}" must be given a whole number of marks, at least 1.`)
      }
      total += criterion.maxMarks
    }
    if (total !== question.maxMarks) {
      throw new Error(
        `Question "${label}" is worth ${question.maxMarks} but its criteria are given ${total}; they must add up.`,
      )
    }

    return { ...question, label, dependsOn }
  })
}

/**
 * The evidence each question will have once saved, checked as a whole: what
 * the input gives, else what is stored. A PowerPoint assessment's are
 * validated against the activity's upload slots; an assessment paper takes
 * none. Throws every problem at once, before anything is written.
 */
async function checkQuestionEvidence(
  client: Queryable,
  activityId: string,
  activity: { type: string | null; body_data: unknown },
  questions: AssessmentQuestionInput[],
): Promise<QuestionEvidence[][]> {
  if (!isPowerPointAssessmentType(activity.type)) {
    const given = questions.filter((q) => q.evidence !== undefined && (!Array.isArray(q.evidence) || q.evidence.length > 0))
    if (given.length > 0) {
      throw new Error(
        `Question ${given.map((q) => `"${q.label}"`).join(", ")}: an assessment paper's questions take no evidence sources; the marker reads the pupil's script.`,
      )
    }
    return questions.map(() => [])
  }

  const { rows: stored } = await client.query<{ label: string; marking: QuestionMarking; evidence: unknown }>(
    "select label, marking, evidence from activity_questions where activity_id = $1",
    [activityId],
  )
  const byLabel = new Map(stored.map((row) => [row.label, row]))
  const { errors, evidence } = validateQuestionEvidence(
    questions.map((q) => ({
      label: q.label,
      marking: q.marking ?? byLabel.get(q.label)?.marking ?? "ai",
      evidence: q.evidence ?? byLabel.get(q.label)?.evidence ?? [],
    })),
    activity.body_data,
  )
  if (errors.length > 0) throw new Error(errors.join(" "))
  return evidence
}

/**
 * Replace an assessment paper's questions with `questions` (matched to the
 * existing ones by label), in one transaction. Then:
 *   - the activity's criteria become the union of the questions' criteria
 *     (activity_success_criteria), so activity_counts_for_progress holds;
 *   - max_marks becomes the sum of the questions;
 *   - marks already given move with any change of allocation (full stays
 *     full, anything else is capped below the new full mark, as migration 130
 *     does for criteria), and every submission is recomputed.
 *
 * A question with pupils' marks cannot be removed. A PowerPoint assessment's
 * questions are refused, all together, when their evidence does not fit the
 * activity's upload slots (checkQuestionEvidence).
 */
export async function setAssessmentQuestions(
  activityId: string,
  input: AssessmentQuestionInput[],
): Promise<AssessmentQuestion[]> {
  const questions = validateQuestions(input)

  return withDbClient(async (client) => {
    await client.query("BEGIN")
    try {
      const { rows: activityRows } = await client.query<{ type: string | null; body_data: unknown }>(
        "select type, body_data from activities where activity_id = $1 for update",
        [activityId],
      )
      if (!activityRows[0]) throw new Error(`Activity ${activityId} not found.`)
      if (!isQuestionMarkedActivityType(activityRows[0].type)) {
        throw new Error(`Activity ${activityId} is not an assessment paper.`)
      }
      const evidence = await checkQuestionEvidence(client, activityId, activityRows[0], questions)
      // Locked up front, before any marks move, in the same order a marking
      // write takes them (submission first), so the two cannot deadlock.
      const { rows: submissions } = await client.query<{ submission_id: string }>(
        "select submission_id from submissions where activity_id = $1 order by submission_id for update",
        [activityId],
      )

      const criterionIds = Array.from(
        new Set(questions.flatMap((q) => q.criteria.map((c) => c.successCriteriaId))),
      )
      const { rows: found } = await client.query<{ success_criteria_id: string }>(
        "select success_criteria_id from success_criteria where success_criteria_id = any($1::text[])",
        [criterionIds],
      )
      const foundIds = new Set(found.map((row) => row.success_criteria_id))
      const missing = criterionIds.filter((id) => !foundIds.has(id))
      if (missing.length > 0) throw new Error(`Success criteria not found: ${missing.join(", ")}`)

      // Questions that are going: refused if any pupil has a mark on them.
      const labels = questions.map((q) => q.label)
      const { rows: removed } = await client.query<{ question_id: string; label: string; marked: boolean }>(
        `select q.question_id, q.label,
                exists (select 1 from submission_question_marks m where m.question_id = q.question_id)
                  or exists (select 1 from submission_question_criterion_marks m
                              where m.question_id = q.question_id) as marked
           from activity_questions q
          where q.activity_id = $1 and not (q.label = any($2::text[]))`,
        [activityId, labels],
      )
      const marked = removed.filter((row) => row.marked).map((row) => row.label)
      if (marked.length > 0) {
        throw new Error(`Pupils have marks on question ${marked.join(", ")}; it cannot be removed.`)
      }
      if (removed.length > 0) {
        await client.query("delete from activity_questions where question_id = any($1::uuid[])", [
          removed.map((row) => row.question_id),
        ])
      }

      // Only rows that actually change are written, so a save that changes
      // nothing does not make the unit's audit stale.
      for (const [position, question] of questions.entries()) {
        const { rows: saved } = await client.query<{ question_id: string }>(
          `with upserted as (
             insert into activity_questions
               (activity_id, label, position, max_marks, question_text, mark_scheme, marking, evidence)
             values ($1, $2, $3, $4, $5, $6, coalesce($7, 'ai'), coalesce($8::jsonb, '[]'::jsonb))
             on conflict (activity_id, label) do update
               set position = excluded.position, max_marks = excluded.max_marks,
                   question_text = excluded.question_text, mark_scheme = excluded.mark_scheme,
                   marking = coalesce($7, activity_questions.marking),
                   evidence = coalesce($8::jsonb, activity_questions.evidence),
                   updated_at = timezone('utc', now())
               where (activity_questions.position, activity_questions.max_marks,
                      activity_questions.question_text, activity_questions.mark_scheme,
                      activity_questions.marking, activity_questions.evidence)
                     is distinct from (excluded.position, excluded.max_marks,
                                       excluded.question_text, excluded.mark_scheme,
                                       coalesce($7, activity_questions.marking),
                                       coalesce($8::jsonb, activity_questions.evidence))
             returning question_id
           )
           select question_id from upserted
           union all
           select question_id from activity_questions where activity_id = $1 and label = $2
           limit 1`,
          [
            activityId,
            question.label,
            position,
            question.maxMarks,
            question.questionText?.trim() || null,
            question.markScheme?.trim() || null,
            question.marking ?? null,
            question.evidence === undefined ? null : JSON.stringify(evidence[position]),
          ],
        )
        const questionId = saved[0].question_id
        const ids = question.criteria.map((c) => c.successCriteriaId)

        // Dropping a criterion from a question drops its marks on it (FK
        // cascade); the question is recomputed from what is left.
        await client.query(
          `delete from activity_question_criteria
            where question_id = $1 and not (success_criteria_id = any($2::text[]))`,
          [questionId, ids],
        )
        await client.query(
          `insert into activity_question_criteria (question_id, success_criteria_id, max_marks, position)
           select $1, c.id, c.max_marks, c.position - 1
             from unnest($2::text[], $3::int[]) with ordinality as c(id, max_marks, position)
           on conflict (question_id, success_criteria_id) do update
             set max_marks = excluded.max_marks, position = excluded.position
             where (activity_question_criteria.max_marks, activity_question_criteria.position)
                   is distinct from (excluded.max_marks, excluded.position)`,
          [questionId, ids, question.criteria.map((c) => c.maxMarks)],
        )
      }

      // Error carried forward, by label, once every question exists. Only an
      // earlier question can be named (validateQuestions), so no cycle forms.
      for (const question of questions) {
        if (question.dependsOn === undefined) continue
        await client.query(
          `update activity_questions q
              set depends_on_question_id = d.question_id, updated_at = timezone('utc', now())
             from (select (select question_id from activity_questions
                            where activity_id = $1 and label = $3) as question_id) d
            where q.activity_id = $1 and q.label = $2
              and q.depends_on_question_id is distinct from d.question_id`,
          [activityId, question.label, question.dependsOn],
        )
      }

      await moveMarksToAllocations(client, activityId)

      // The activity's criteria follow the questions. The link trigger skips
      // this type (migration 132): the recompute below does its work.
      const { rows: linked } = await client.query<{ success_criteria_id: string }>(
        "select success_criteria_id from activity_success_criteria where activity_id = $1",
        [activityId],
      )
      const linkedIds = new Set(linked.map((row) => row.success_criteria_id))
      for (const scId of criterionIds.filter((id) => !linkedIds.has(id))) {
        await assertScAllowedForActivity(client, activityId, scId)
      }
      await client.query(
        `insert into activity_success_criteria (activity_id, success_criteria_id)
         select $1, unnest($2::text[])
         on conflict do nothing`,
        [activityId, criterionIds.filter((id) => !linkedIds.has(id))],
      )
      await client.query(
        `delete from activity_success_criteria
          where activity_id = $1 and not (success_criteria_id = any($2::text[]))`,
        [activityId, criterionIds],
      )

      await recalculateAssessmentPaperMaxMarks(client, activityId)

      for (const row of submissions) {
        await recomputeAssessmentSubmission(client, row.submission_id)
      }

      const result = await readQuestions(client, activityId)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  })
}

/**
 * After a change of allocations or question marks, bring every stored mark on
 * the activity to its new marks available: full stays full, anything else is
 * capped one below the new full mark.
 *
 * A criterion row is out of its allocation, except on an unsplit legacy
 * question (legacy question row, no AI or teacher criterion row), where it is
 * out of the question's marks.
 */
async function moveMarksToAllocations(db: Queryable, activityId: string): Promise<void> {
  await db.query(
    `update submission_question_marks m
        set awarded = case when m.awarded >= m.available then q.max_marks
                           else least(m.awarded, q.max_marks - 1) end,
            available = q.max_marks,
            updated_at = timezone('utc', now())
       from activity_questions q
      where q.question_id = m.question_id and q.activity_id = $1
        and m.provenance = 'legacy' and m.available <> q.max_marks`,
    [activityId],
  )

  await db.query(
    `with target as (
       select cm.submission_id, cm.question_id, cm.success_criteria_id,
              case when cm.provenance = 'legacy'
                        and exists (select 1 from submission_question_marks qm
                                     where qm.submission_id = cm.submission_id
                                       and qm.question_id = cm.question_id
                                       and qm.provenance = 'legacy')
                        and not exists (select 1 from submission_question_criterion_marks o
                                         where o.submission_id = cm.submission_id
                                           and o.question_id = cm.question_id
                                           and o.provenance <> 'legacy')
                   then q.max_marks
                   else c.max_marks end as available
         from submission_question_criterion_marks cm
         join activity_questions q on q.question_id = cm.question_id
         join activity_question_criteria c
           on c.question_id = cm.question_id and c.success_criteria_id = cm.success_criteria_id
        where q.activity_id = $1
     )
     update submission_question_criterion_marks m
        set awarded = case when m.awarded >= m.available then t.available
                           else least(m.awarded, t.available - 1) end,
            ai_awarded = case when m.ai_awarded is null then null
                              when m.ai_awarded >= m.available then t.available
                              else least(m.ai_awarded, t.available - 1) end,
            available = t.available,
            updated_at = timezone('utc', now())
       from target t
      where t.submission_id = m.submission_id and t.question_id = m.question_id
        and t.success_criteria_id = m.success_criteria_id
        and m.available <> t.available`,
    [activityId],
  )
}

/** Lock a submission of an assessment paper; returns its activity id. */
async function isPowerPointActivity(db: Queryable, activityId: string): Promise<boolean> {
  const { rows } = await db.query<{ type: string | null }>("select type from activities where activity_id = $1", [activityId])
  return isPowerPointAssessmentType(rows[0]?.type)
}

async function lockAssessmentSubmission(db: Queryable, submissionId: string): Promise<string> {
  const { rows } = await db.query<{ activity_id: string; type: string | null }>(
    `select s.activity_id, a.type
       from submissions s join activities a on a.activity_id = s.activity_id
      where s.submission_id = $1
      for update of s`,
    [submissionId],
  )
  const row = rows[0]
  if (!row) throw new Error(`Submission ${submissionId} not found.`)
  if (!isQuestionMarkedActivityType(row.type)) {
    throw new Error(`Submission ${submissionId} is not on an assessment paper.`)
  }
  return row.activity_id
}

/**
 * A legacy question's criterion rows each hold the whole question's mark. To
 * mark one criterion within it, the question is first split: its mark is
 * shared out across its criteria in order, each filled up to its allocation
 * (3/4 over 2 + 2 -> 2/2, 1/2), so the question's total is unchanged. The rows
 * stay 'legacy', so a re-mark replaces them. No-op unless the question is an
 * unsplit legacy one.
 */
async function splitLegacyQuestion(db: Queryable, submissionId: string, questionId: string): Promise<void> {
  const { rows } = await db.query<{ awarded: number }>(
    `select qm.awarded
       from submission_question_marks qm
      where qm.submission_id = $1 and qm.question_id = $2 and qm.provenance = 'legacy'
        and not exists (select 1 from submission_question_criterion_marks o
                         where o.submission_id = $1 and o.question_id = $2
                           and o.provenance <> 'legacy')`,
    [submissionId, questionId],
  )
  if (!rows[0]) return

  let remaining = Number(rows[0].awarded)
  const { rows: allocations } = await db.query<{ success_criteria_id: string; max_marks: number }>(
    `select success_criteria_id, max_marks from activity_question_criteria
      where question_id = $1 order by position, success_criteria_id`,
    [questionId],
  )
  for (const allocation of allocations) {
    const share = Math.min(remaining, Number(allocation.max_marks))
    remaining -= share
    await db.query(
      `insert into submission_question_criterion_marks
         (submission_id, question_id, success_criteria_id, awarded, available, provenance)
       values ($1, $2, $3, $4, $5, 'legacy')
       on conflict (submission_id, question_id, success_criteria_id) do update
         set awarded = excluded.awarded, available = excluded.available,
             updated_at = timezone('utc', now())`,
      [submissionId, questionId, allocation.success_criteria_id, share, allocation.max_marks],
    )
  }
}

async function writeCriterionMarks(
  db: Queryable,
  submissionId: string,
  rows: QuestionCriterionMarkInput[],
  provenance: "ai" | "teacher",
  teacherFeedback?: string | null,
): Promise<void> {
  const activityId = await lockAssessmentSubmission(db, submissionId)

  const { rows: allocations } = await db.query<{
    question_id: string
    success_criteria_id: string
    max_marks: number
  }>(
    `select c.question_id, c.success_criteria_id, c.max_marks
       from activity_question_criteria c
       join activity_questions q on q.question_id = c.question_id
      where q.activity_id = $1`,
    [activityId],
  )
  const allocationOf = new Map(
    allocations.map((a) => [`${a.question_id}|${a.success_criteria_id}`, Number(a.max_marks)]),
  )

  for (const row of rows) {
    const available = allocationOf.get(`${row.questionId}|${row.successCriteriaId}`)
    if (available === undefined) {
      throw new Error(`Success criterion ${row.successCriteriaId} is not tested by question ${row.questionId}.`)
    }
    if (!Number.isInteger(row.awarded) || row.awarded < 0 || row.awarded > available) {
      throw new Error(`Awarded marks must be a whole number from 0 to ${available}.`)
    }
  }

  for (const questionId of new Set(rows.map((row) => row.questionId))) {
    await splitLegacyQuestion(db, submissionId, questionId)
  }

  for (const row of rows) {
    const available = allocationOf.get(`${row.questionId}|${row.successCriteriaId}`)!
    // A teacher's mark is never overwritten by the marker. Under a teacher's
    // mark the marker's comments are kept while the mark is the one they
    // explain, and dropped once the teacher changes it; teacher_feedback sits
    // beside them (see effectiveQuestionCriterionFeedback). ai_awarded keeps
    // the marker's own mark (migration 141): set by every marker write, never
    // by a teacher's, so a teacher row made with no marker row before it
    // leaves it null.
    await db.query(
      `insert into submission_question_criterion_marks
         (submission_id, question_id, success_criteria_id, awarded, available,
          why_not_awarded, how_to_improve, teacher_feedback, provenance, ai_awarded)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $9 = 'ai' then $4::int end)
       on conflict (submission_id, question_id, success_criteria_id) do update
         set awarded = excluded.awarded,
             available = excluded.available,
             ai_awarded = case when $9 = 'ai' then excluded.awarded
                               else submission_question_criterion_marks.ai_awarded end,
             why_not_awarded = case when $9 <> 'teacher' then excluded.why_not_awarded
                                    when submission_question_criterion_marks.awarded = excluded.awarded
                                    then submission_question_criterion_marks.why_not_awarded end,
             how_to_improve = case when $9 <> 'teacher' then excluded.how_to_improve
                                   when submission_question_criterion_marks.awarded = excluded.awarded
                                   then submission_question_criterion_marks.how_to_improve end,
             teacher_feedback = case when $10::boolean then excluded.teacher_feedback
                                     else submission_question_criterion_marks.teacher_feedback end,
             provenance = excluded.provenance,
             updated_at = timezone('utc', now())
         where submission_question_criterion_marks.provenance <> 'teacher' or $9 = 'teacher'`,
      [
        submissionId,
        row.questionId,
        row.successCriteriaId,
        row.awarded,
        available,
        provenance === "teacher" ? null : row.whyNotAwarded?.trim() || null,
        provenance === "teacher" ? null : row.howToImprove?.trim() || null,
        teacherFeedback?.trim() || null,
        provenance,
        teacherFeedback !== undefined,
      ],
    )
  }

  await recomputeAssessmentSubmission(db, submissionId)
}

/**
 * Record the marker's (or a teacher's) marks for criteria within questions,
 * then recompute the submission. A teacher's row is only ever replaced by
 * another teacher mark.
 */
export async function recordQuestionCriterionMarks(
  submissionId: string,
  rows: QuestionCriterionMarkInput[],
  provenance: "ai" | "teacher",
): Promise<AssessmentSubmissionTotals | null> {
  return inTransaction(async (client) => {
    await writeCriterionMarks(client, submissionId, rows, provenance)
    return readTotals(client, submissionId)
  })
}

/** Open read and mark jobs of a submission other than `jobId`. */
async function countOpenAssessmentJobs(db: Queryable, submissionId: string, jobId: string): Promise<number> {
  const { rows } = await db.query<{ open: string }>(
    `select count(*)::text as open from external_jobs
      where job_type in ('ai_read', 'ai_mark') and status in ('pending', 'processing')
        and payload->>'submissionId' = $1 and job_id <> $2`,
    [submissionId, jobId],
  )
  return Number(rows[0]?.open ?? 0)
}

/**
 * PowerPoint assessment questions whose reference_file sources name a file
 * that is not among the activity's files (lessons bucket,
 * {lessonId}/activities/{activityId}/{fileName}), with the missing names.
 * Such a question cannot be marked as set, so it is held like one with no
 * mark scheme. An assessment paper's questions have no evidence, so none.
 */
async function missingReferenceFiles(db: Queryable, activityId: string): Promise<Map<string, string[]>> {
  const { rows } = await db.query<{ question_id: string; missing: string[] }>(
    `select q.question_id, array_agg(distinct e->>'fileName' order by e->>'fileName') as missing
       from activity_questions q
       join activities a on a.activity_id = q.activity_id
      cross join lateral jsonb_array_elements(q.evidence) e
      where q.activity_id = $1 and e->>'source' = 'reference_file'
        and not exists (select 1 from stored_files f
                         where f.bucket = 'lessons'
                           and f.scope_path = a.lesson_id || '/activities/' || a.activity_id
                           and f.file_name = e->>'fileName')
      group by q.question_id`,
    [activityId],
  )
  return new Map(rows.map((row) => [row.question_id, row.missing]))
}

/**
 * Questions of a read submission that the marker cannot be sent: no mark
 * scheme text, or (a PowerPoint assessment) a reference file that is not
 * among the activity's files or a required screenshot DINO cannot show (the
 * answer's transcription says which); not teacher-only, not blank, and not already
 * marked by anyone. The reason goes in mark_error so the results page says
 * what is waiting.
 */
async function heldQuestionsMessage(db: Queryable, submissionId: string): Promise<string | null> {
  const { rows } = await db.query<{
    question_id: string
    label: string
    activity_id: string
    no_mark_scheme: boolean
    unshowable: string | null
  }>(
    `select q.question_id, q.label, q.activity_id,
            nullif(btrim(coalesce(q.mark_scheme, '')), '') is null as no_mark_scheme,
            case when a.status = 'unreadable' and x.type = 'powerpoint-assessment' then a.transcription end as unshowable
       from submissions s
       join activities x on x.activity_id = s.activity_id
       join activity_questions q on q.activity_id = s.activity_id
       join submission_question_answers a on a.submission_id = s.submission_id and a.question_id = q.question_id
      where s.submission_id = $1
        and q.marking <> 'teacher' and a.status <> 'blank'
        and not exists (select 1 from submission_question_criterion_marks m
                         where m.submission_id = s.submission_id and m.question_id = q.question_id
                           and m.provenance <> 'legacy')
      order by q.position, q.label`,
    [submissionId],
  )
  if (rows.length === 0) return null
  const messages: string[] = []
  const noScheme = rows.filter((row) => row.no_mark_scheme)
  if (noScheme.length > 0) {
    const labels = noScheme.map((row) => row.label).join(", ")
    messages.push(
      `Not sent for marking: question${noScheme.length === 1 ? "" : "s"} ${labels} ${noScheme.length === 1 ? "has" : "have"} no mark scheme text. Add it in the lesson editor, or mark ${noScheme.length === 1 ? "it" : "them"} yourself.`,
    )
  }
  for (const row of rows) {
    if (row.no_mark_scheme || !row.unshowable) continue
    messages.push(`Not sent for marking: question ${row.label}: ${row.unshowable}`)
  }
  const withScheme = rows.filter((row) => !row.no_mark_scheme)
  if (withScheme.length > 0) {
    const missing = await missingReferenceFiles(db, withScheme[0].activity_id)
    for (const row of withScheme) {
      const names = missing.get(row.question_id)
      if (!names) continue
      const files = names.map((name) => `"${name}"`).join(", ")
      messages.push(
        `Not sent for marking: question ${row.label} reads the reference file${names.length === 1 ? "" : "s"} ${files}, which ${names.length === 1 ? "is" : "are"} not among the activity's files. Upload ${names.length === 1 ? "it" : "them"} to the activity, or mark the question yourself.`,
      )
    }
  }
  return messages.length > 0 ? messages.join(" ") : null
}

/**
 * Close a read or mark job inside the caller's transaction (which holds the
 * submission's row lock) and, when it was the last open job, mark the
 * submission. Returns whether this completed the submission.
 *
 * Sibling mark jobs for one submission run concurrently. The row lock
 * serialises them and the job is closed in the same transaction, so whichever
 * finishes last sees no open job. A job no longer 'processing' was abandoned
 * (a sibling failed permanently) or recovered: its rows are still written, as
 * they are correct, but it does not complete the submission.
 */
/**
 * The job's status, read inside the caller's transaction after the
 * submission's row lock (which a new hand-in or upload also takes before it
 * replaces the jobs), or null when the job has gone: it was superseded.
 */
async function assessmentJobStatus(db: Queryable, jobId: string): Promise<string | null> {
  const { rows } = await db.query<{ status: string }>("select status from external_jobs where job_id = $1", [jobId])
  return rows[0]?.status ?? null
}

async function closeAssessmentJob(db: Queryable, submissionId: string, jobId: string): Promise<boolean> {
  const closed = await db.query(
    `update external_jobs set status = 'done', updated_at = now()
      where job_id = $1 and status = 'processing'
      returning job_id`,
    [jobId],
  )
  if (closed.rows.length === 0) return false
  if ((await countOpenAssessmentJobs(db, submissionId, jobId)) > 0) return false
  const marked = await db.query(
    `update submissions set mark_status = 'marked', mark_error = $2
      where submission_id = $1 and mark_status in ('waiting', 'marking')
      returning submission_id`,
    [submissionId, await heldQuestionsMessage(db, submissionId)],
  )
  return marked.rows.length > 0
}

export type ReadCompletion = {
  /** Questions sent to the marker, one ai_mark job each. */
  queuedQuestionIds: string[]
  /** Blank answers given 0 with NO_ANSWER_COMMENT (or the reader's blankReason). */
  blankQuestionIds: string[]
  /** Teacher-only questions, left for the teacher. */
  teacherQuestionIds: string[]
  /** Questions with no mark scheme text, held (see heldQuestionsMessage). */
  heldQuestionIds: string[]
  totals: AssessmentSubmissionTotals | null
  complete: boolean
  /** The read job was no longer this run's (a newer hand-in replaced it): nothing was written. */
  superseded?: boolean
}

/**
 * The reader's result for one script, and what follows from it, in one
 * transaction under the submission's row lock:
 *
 *   - each answer is stored (provenance ai), except where a teacher has
 *     already edited that question's answer, which is kept;
 *   - a blank answer scores 0 on every criterion with NO_ANSWER_COMMENT,
 *     or the reader's blankReason when it gave one;
 *   - a teacher-only question is left for the teacher;
 *   - a question with no mark scheme text, or (a PowerPoint assessment) whose
 *     reference file is not among the activity's files, is held, and named
 *     in mark_error;
 *   - a question whose every criterion a teacher has marked is not re-sent;
 *   - every other question gets one ai_mark job, {submissionId, questionId}.
 *
 * Then the read job is closed, and if nothing is left open the submission is
 * marked. A read job that is no longer 'processing' (deleted when the work
 * was sent again) writes nothing: its answers are of files since replaced.
 *
 * On a PowerPoint assessment an 'unreadable' answer (a required screenshot
 * that is only pictures DINO cannot show) is held for the teacher, its
 * transcription saying why, like a question with no mark scheme.
 */
export async function completeAssessmentRead(input: {
  submissionId: string
  assignmentId: string
  jobId: string
  answers: SubmissionQuestionAnswerInput[]
}): Promise<ReadCompletion> {
  const { submissionId, jobId } = input
  return inTransaction(async (client) => {
    const activityId = await lockAssessmentSubmission(client, submissionId)
    if ((await assessmentJobStatus(client, jobId)) !== "processing") {
      return {
        queuedQuestionIds: [],
        blankQuestionIds: [],
        teacherQuestionIds: [],
        heldQuestionIds: [],
        totals: null,
        complete: false,
        superseded: true,
      }
    }
    const powerPoint = await isPowerPointActivity(client, activityId)
    const questions = await readQuestions(client, activityId)
    const questionIds = new Set(questions.map((q) => q.questionId))

    for (const answer of input.answers) {
      if (!questionIds.has(answer.questionId)) {
        throw new Error(`Question ${answer.questionId} is not on this assessment paper.`)
      }
      await client.query(
        `insert into submission_question_answers
           (submission_id, question_id, kind, transcription, pages, status, provenance)
         values ($1, $2, $3, $4, $5, $6, 'ai')
         on conflict (submission_id, question_id) do update
           set kind = excluded.kind, transcription = excluded.transcription, pages = excluded.pages,
               status = excluded.status, provenance = 'ai', updated_at = timezone('utc', now())
           where submission_question_answers.provenance <> 'teacher'`,
        [submissionId, answer.questionId, answer.kind, answer.transcription, answer.pages, answer.status],
      )
    }

    const stored = await readAnswers(client, submissionId)
    const { rows: teacherMarked } = await client.query<{ question_id: string }>(
      `select c.question_id
         from activity_question_criteria c
         join activity_questions q on q.question_id = c.question_id
         left join submission_question_criterion_marks m
           on m.submission_id = $1 and m.question_id = c.question_id
          and m.success_criteria_id = c.success_criteria_id and m.provenance = 'teacher'
        where q.activity_id = $2
        group by c.question_id
       having bool_and(m.success_criteria_id is not null)`,
      [submissionId, activityId],
    )
    const fullyTeacherMarked = new Set(teacherMarked.map((row) => row.question_id))
    const missingReference = await missingReferenceFiles(client, activityId)

    const blankReasons = new Map(
      input.answers.flatMap((answer) =>
        answer.status === "blank" && answer.blankReason?.trim() ? [[answer.questionId, answer.blankReason.trim()] as const] : [],
      ),
    )

    const result: ReadCompletion = {
      queuedQuestionIds: [],
      blankQuestionIds: [],
      teacherQuestionIds: [],
      heldQuestionIds: [],
      totals: null,
      complete: false,
    }
    const zeroRows: QuestionCriterionMarkInput[] = []

    for (const question of questions) {
      const answer = stored.get(question.questionId)
      if (question.marking === "teacher") {
        result.teacherQuestionIds.push(question.questionId)
        continue
      }
      if (answer?.status === "blank") {
        result.blankQuestionIds.push(question.questionId)
        // The reader's reason, unless a teacher's edited answer stands instead.
        const why = (answer.provenance === "ai" ? blankReasons.get(question.questionId) : undefined) ?? NO_ANSWER_COMMENT
        for (const criterion of question.criteria) {
          zeroRows.push({
            questionId: question.questionId,
            successCriteriaId: criterion.successCriteriaId,
            awarded: 0,
            whyNotAwarded: why,
            howToImprove: null,
          })
        }
        continue
      }
      if (
        !question.markScheme?.trim() ||
        missingReference.has(question.questionId) ||
        (powerPoint && answer?.status === "unreadable")
      ) {
        result.heldQuestionIds.push(question.questionId)
        continue
      }
      if (fullyTeacherMarked.has(question.questionId)) continue
      result.queuedQuestionIds.push(question.questionId)
    }

    if (zeroRows.length > 0) {
      await writeCriterionMarks(client, submissionId, zeroRows, "ai")
    } else {
      await recomputeAssessmentSubmission(client, submissionId)
    }

    // Queued in this transaction, so the read job never closes without them.
    await client.query(
      `delete from external_jobs
        where job_type = 'ai_mark' and status in ('pending', 'processing')
          and payload->>'submissionId' = $1 and payload->>'questionId' = any($2::text[])`,
      [submissionId, result.queuedQuestionIds],
    )
    if (result.queuedQuestionIds.length > 0) {
      await client.query(
        `insert into external_jobs (job_type, payload)
         select 'ai_mark', jsonb_build_object('submissionId', $1::text, 'assignmentId', $2::text, 'questionId', q)
           from unnest($3::text[]) as q`,
        [submissionId, input.assignmentId, result.queuedQuestionIds],
      )
    }

    result.complete = await closeAssessmentJob(client, submissionId, jobId)
    if (!result.complete && result.queuedQuestionIds.length === 0) {
      // Still open elsewhere, or abandoned; either way say what is held.
      const held = await heldQuestionsMessage(client, submissionId)
      if (held) await client.query("update submissions set mark_error = $2 where submission_id = $1", [submissionId, held])
    }
    result.totals = await readTotals(client, submissionId)
    return result
  })
}

/**
 * The marker's result for one question of one script, and the job's
 * completion, in one transaction under the submission's row lock. Rows are
 * written as 'ai' and never replace a teacher's (writeCriterionMarks). With no
 * rows (the question became teacher-only, or lost its mark scheme, after the
 * job was queued) the job is just closed. A job that has gone (the work was
 * sent again) writes nothing. `markerEvidence` (a PowerPoint
 * assessment's marker's note on the evidence, teacher-only) is stored on the
 * question's answer as marker_evidence; an assessment paper passes none.
 */
export async function completeAssessmentQuestionMark(input: {
  submissionId: string
  jobId: string
  rows: QuestionCriterionMarkInput[]
  markerEvidence?: { questionId: string; text: string | null }
}): Promise<{ totals: AssessmentSubmissionTotals | null; complete: boolean; superseded?: boolean }> {
  return inTransaction(async (client) => {
    await lockAssessmentSubmission(client, input.submissionId)
    // Gone, or back in the queue: the work was sent again since this job was
    // claimed, so its marks are of files since replaced. An abandoned job
    // ('error', a sibling failed) still writes: its marks are correct.
    const status = await assessmentJobStatus(client, input.jobId)
    if (status !== "processing" && status !== "error") {
      return { totals: await readTotals(client, input.submissionId), complete: false, superseded: true }
    }
    if (input.rows.length > 0) await writeCriterionMarks(client, input.submissionId, input.rows, "ai")
    if (input.markerEvidence) {
      await client.query(
        `update submission_question_answers set marker_evidence = $3, updated_at = timezone('utc', now())
          where submission_id = $1 and question_id = $2`,
        [input.submissionId, input.markerEvidence.questionId, input.markerEvidence.text],
      )
    }
    const complete = await closeAssessmentJob(client, input.submissionId, input.jobId)
    return { totals: await readTotals(client, input.submissionId), complete }
  })
}

/**
 * Questions held at the read for want of a mark scheme that can now be sent:
 * on pupils' latest submissions (or `submissionId` alone) whose read is
 * complete (the question has an answer row, no read job is open); the
 * question is not teacher-only, its answer is not blank, it has mark scheme
 * text now, nobody has marked it (no ai or teacher rows) and no mark job is
 * open for it. Per type, what "read complete" also needs:
 *
 *   assessment paper     the newest script passed the front sheet check;
 *                        never a folded paper.
 *   PowerPoint           handed in, and no file the reader refused (such a
 *                        submission is held whole: send the work again). An
 *                        answer held for pictures DINO cannot show
 *                        ('unreadable') stays with the teacher, and so does a
 *                        question whose reference file is missing.
 */
async function selectHeldQuestionsToSend(
  db: Queryable,
  activityId: string,
  submissionId: string | null,
): Promise<Array<{ submissionId: string; pupilId: string; questionId: string }>> {
  const { rows: typeRows } = await db.query<{ type: string | null }>(
    "select type from activities where activity_id = $1",
    [activityId],
  )
  const powerPoint = isPowerPointAssessmentType(typeRows[0]?.type)
  if (!powerPoint && !isAssessmentPaperType(typeRows[0]?.type)) return []
  const typeCondition = powerPoint
    ? `l.submission_status = 'submitted' and a.status <> 'unreadable'
        and not exists (select 1 from practical_submission_evidence e
                         where e.submission_id = l.submission_id and e.status = 'error')`
    : `not exists (select 1 from activities x
                    where x.activity_id = $1 and coalesce(x.body_data ? 'foldedFromAssessmentIds', false))
        and exists (select 1 from (select sc.front_sheet_check, sc.page_paths from assessment_scripts sc
                                    where sc.submission_id = l.submission_id
                                    order by sc.uploaded_at desc, sc.script_id desc
                                    limit 1) script
                     where script.front_sheet_check = 'passed' and cardinality(script.page_paths) > 0)`
  const { rows } = await db.query<{ submission_id: string; user_id: string; question_id: string }>(
    `with latest as (
       select distinct on (s.user_id) s.submission_id, s.user_id, s.submission_status
         from submissions s
        where s.activity_id = $1
        order by s.user_id, s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
     )
     select l.submission_id, l.user_id, q.question_id
       from latest l
       join activity_questions q on q.activity_id = $1
       join submission_question_answers a on a.submission_id = l.submission_id and a.question_id = q.question_id
      where ($2::text is null or l.submission_id = $2)
        and ${typeCondition}
        and q.marking <> 'teacher' and a.status <> 'blank'
        and nullif(btrim(coalesce(q.mark_scheme, '')), '') is not null
        and not exists (select 1 from submission_question_criterion_marks m
                         where m.submission_id = l.submission_id and m.question_id = q.question_id
                           and m.provenance <> 'legacy')
        and not exists (select 1 from external_jobs j
                         where j.job_type = 'ai_read' and j.status in ('pending', 'processing')
                           and j.payload->>'submissionId' = l.submission_id)
        and not exists (select 1 from external_jobs j
                         where j.job_type = 'ai_mark' and j.status in ('pending', 'processing')
                           and j.payload->>'submissionId' = l.submission_id
                           and j.payload->>'questionId' = q.question_id::text)
      order by l.user_id, q.position, q.label`,
    [activityId, submissionId],
  )
  const missingReference = powerPoint ? await missingReferenceFiles(db, activityId) : new Map<string, string[]>()
  return rows
    .filter((row) => !missingReference.has(row.question_id))
    .map((row) => ({ submissionId: row.submission_id, pupilId: row.user_id, questionId: row.question_id }))
}

/** The held questions that can be sent now (see selectHeldQuestionsToSend). */
export async function listHeldQuestionsToSend(
  activityId: string,
): Promise<Array<{ submissionId: string; pupilId: string; questionId: string }>> {
  return selectHeldQuestionsToSend({ query } as Queryable, activityId, null)
}

/**
 * Send one submission's held questions (selectHeldQuestionsToSend, checked
 * again under the submission's row lock): one ai_mark job each, as the read
 * would have queued them, and the submission waits again until they are
 * marked. Returns the questions queued.
 */
export async function queueHeldAssessmentQuestions(input: {
  activityId: string
  submissionId: string
  assignmentId: string
}): Promise<string[]> {
  return inTransaction(async (client) => {
    const activityId = await lockAssessmentSubmission(client, input.submissionId)
    if (activityId !== input.activityId) {
      throw new Error(`Submission ${input.submissionId} is not on assessment paper ${input.activityId}.`)
    }
    const questionIds = (await selectHeldQuestionsToSend(client, activityId, input.submissionId)).map(
      (row) => row.questionId,
    )
    if (questionIds.length === 0) return []
    await client.query(
      `insert into external_jobs (job_type, payload)
       select 'ai_mark', jsonb_build_object('submissionId', $1::text, 'assignmentId', $2::text, 'questionId', q)
         from unnest($3::text[]) as q`,
      [input.submissionId, input.assignmentId, questionIds],
    )
    await client.query(
      "update submissions set mark_status = 'waiting', mark_error = $2 where submission_id = $1",
      [input.submissionId, await heldQuestionsMessage(client, input.submissionId)],
    )
    return questionIds
  })
}

async function readAnswers(db: Queryable, submissionId: string): Promise<Map<string, SubmissionQuestionAnswer>> {
  const { rows } = await db.query<{
    question_id: string
    kind: AnswerKind
    transcription: string | null
    pages: number[] | null
    status: AnswerStatus
    provenance: "ai" | "teacher"
  }>(
    `select question_id, kind, transcription, pages, status, provenance
       from submission_question_answers where submission_id = $1`,
    [submissionId],
  )
  return new Map(
    rows.map((row) => [
      row.question_id,
      {
        questionId: row.question_id,
        kind: row.kind,
        transcription: row.transcription,
        pages: (row.pages ?? []).map(Number),
        status: row.status,
        provenance: row.provenance,
      },
    ]),
  )
}

/** The reader's answers on a submission, by question id. */
export async function readSubmissionAnswers(submissionId: string): Promise<Map<string, SubmissionQuestionAnswer>> {
  return readAnswers({ query } as Queryable, submissionId)
}

/**
 * A teacher's correction of what the reader transcribed for one question.
 * Stamped 'teacher', so a re-read keeps it. A question the reader never
 * recorded gets a row of its own (text, answered, no pages).
 */
export async function setTeacherAnswerTranscription(
  submissionId: string,
  questionId: string,
  transcription: string | null,
): Promise<SubmissionQuestionAnswer> {
  return inTransaction(async (client) => {
    const activityId = await lockAssessmentSubmission(client, submissionId)
    const { rows } = await client.query(
      "select 1 from activity_questions where question_id = $1 and activity_id = $2",
      [questionId, activityId],
    )
    if (rows.length === 0) throw new Error(`Question ${questionId} is not on this assessment paper.`)
    await client.query(
      `insert into submission_question_answers
         (submission_id, question_id, kind, transcription, pages, status, provenance)
       values ($1, $2, 'text', $3, '{}', 'answered', 'teacher')
       on conflict (submission_id, question_id) do update
         set transcription = excluded.transcription, provenance = 'teacher',
             updated_at = timezone('utc', now())`,
      [submissionId, questionId, transcription?.trim() || null],
    )
    return (await readAnswers(client, submissionId)).get(questionId)!
  })
}

/**
 * A teacher confirms the marker's marks on one question as they stand: its
 * 'ai' criterion rows are stamped 'teacher' with marks and comments unchanged,
 * so the question no longer awaits a check and a re-mark keeps it. Refused
 * when the question has no marks yet.
 */
export async function confirmAssessmentQuestionMarks(
  submissionId: string,
  questionId: string,
): Promise<AssessmentSubmissionTotals | null> {
  return inTransaction(async (client) => {
    await lockAssessmentSubmission(client, submissionId)
    const { rows } = await client.query(
      `select 1 from submission_question_criterion_marks
        where submission_id = $1 and question_id = $2 and provenance <> 'legacy' limit 1`,
      [submissionId, questionId],
    )
    if (rows.length === 0) throw new Error("This question has no marks to confirm yet.")
    await client.query(
      `update submission_question_criterion_marks
          set provenance = 'teacher', updated_at = timezone('utc', now())
        where submission_id = $1 and question_id = $2 and provenance = 'ai'`,
      [submissionId, questionId],
    )
    await recomputeAssessmentSubmission(client, submissionId)
    return readTotals(client, submissionId)
  })
}

/**
 * Questions awaiting a teacher's check, on the latest submission of each
 * pupil (or on `submissionId` alone): marked by the model ('ai' rows remain)
 * and either set to 'ai_check', read as a sketch, or read as unreadable,
 * unless the question is teacher-only.
 */
export async function listQuestionsAwaitingCheck(
  activityId: string,
  submissionId: string | null = null,
): Promise<Array<{ submissionId: string; questionId: string }>> {
  const { rows } = await query<{ submission_id: string; question_id: string }>(
    `with latest as (
       select distinct on (s.user_id) s.submission_id
         from submissions s
        where s.activity_id = $1 and ($2::text is null or s.submission_id = $2)
        order by s.user_id, s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
     )
     select l.submission_id, q.question_id
       from latest l
       join activity_questions q on q.activity_id = $1
       left join submission_question_answers a
         on a.submission_id = l.submission_id and a.question_id = q.question_id
      where q.marking <> 'teacher'
        and (q.marking = 'ai_check' or a.kind = 'sketch' or a.status = 'unreadable')
        and exists (select 1 from submission_question_criterion_marks m
                     where m.submission_id = l.submission_id and m.question_id = q.question_id
                       and m.provenance = 'ai')
      order by l.submission_id, q.position, q.label`,
    [activityId, submissionId],
  )
  return rows.map((row) => ({ submissionId: row.submission_id, questionId: row.question_id }))
}

/**
 * A teacher's mark for one criterion within one question. `feedback`, when
 * given, replaces the teacher's comment on it (empty clears it); omitted, the
 * comment is left as it was.
 */
export async function setTeacherQuestionCriterionMark(
  submissionId: string,
  questionId: string,
  successCriteriaId: string,
  awarded: number,
  feedback?: string | null,
): Promise<AssessmentSubmissionTotals | null> {
  return inTransaction(async (client) => {
    await writeCriterionMarks(
      client,
      submissionId,
      [{ questionId, successCriteriaId, awarded }],
      "teacher",
      feedback === undefined ? undefined : (feedback ?? ""),
    )
    return readTotals(client, submissionId)
  })
}

/**
 * A teacher's comment on one criterion within one question, without changing
 * its mark (empty clears it). The comment is shown in place of the marker's
 * wherever the criterion is displayed (effectiveQuestionCriterionFeedback);
 * the mark, and so its provenance, stay as they were. Refused for a criterion
 * with no mark yet: mark it first.
 */
export async function setTeacherQuestionCriterionComment(
  submissionId: string,
  questionId: string,
  successCriteriaId: string,
  feedback: string | null,
): Promise<string | null> {
  return inTransaction(async (client) => {
    await lockAssessmentSubmission(client, submissionId)
    const saved = feedback?.trim() || null
    const { rows } = await client.query(
      `update submission_question_criterion_marks
          set teacher_feedback = $4, updated_at = timezone('utc', now())
        where submission_id = $1 and question_id = $2 and success_criteria_id = $3
        returning 1`,
      [submissionId, questionId, successCriteriaId, saved],
    )
    if (rows.length === 0) {
      throw new Error("Mark this criterion before commenting on it.")
    }
    // submission_sc_marks carries the teacher's comments across questions.
    await recomputeAssessmentSubmission(client, submissionId)
    return saved
  })
}

/**
 * The comment a criterion within a question shows. The rule is
 * effectiveCriterionFeedback's: a teacher's comment wins; a mark the teacher
 * changed without commenting shows no comment, since the marker's explained
 * a mark that no longer stands; otherwise the marker's. The store drops the
 * marker's text when a teacher changes the mark (writeCriterionMarks), so a
 * teacher row that still has it is one the teacher confirmed or re-entered
 * unchanged, and the text still applies.
 */
export function effectiveQuestionCriterionFeedback(row: {
  whyNotAwarded: string | null
  howToImprove: string | null
  teacherFeedback: string | null
  provenance: QuestionMarkProvenance | null
}):
  | { source: "teacher"; text: string }
  | { source: "ai"; whyNotAwarded: string | null; howToImprove: string | null }
  | null {
  const teacher = row.teacherFeedback?.trim()
  if (teacher) return { source: "teacher", text: teacher }
  const whyNotAwarded = row.whyNotAwarded?.trim() || null
  const howToImprove = row.howToImprove?.trim() || null
  if (!whyNotAwarded && !howToImprove) return null
  return { source: "ai", whyNotAwarded, howToImprove }
}

/**
 * An old mark for a whole question, from a paper folded in from the old
 * assessments module. The split is unknown, so every criterion on the question
 * records the same mark out of the question's marks. Refused once a teacher
 * has marked a criterion on the question.
 */
export async function recordLegacyQuestionMark(
  submissionId: string,
  questionId: string,
  awarded: number,
  whyNotAwarded: string | null,
  howToImprove: string | null,
): Promise<AssessmentSubmissionTotals | null> {
  return inTransaction(async (client) => {
    const activityId = await lockAssessmentSubmission(client, submissionId)
    const { rows } = await client.query<{ max_marks: number }>(
      "select max_marks from activity_questions where question_id = $1 and activity_id = $2",
      [questionId, activityId],
    )
    if (!rows[0]) throw new Error(`Question ${questionId} is not on this assessment paper.`)
    const available = Number(rows[0].max_marks)
    if (!Number.isInteger(awarded) || awarded < 0 || awarded > available) {
      throw new Error(`Awarded marks must be a whole number from 0 to ${available}.`)
    }

    const { rows: teacherRows } = await client.query(
      `select 1 from submission_question_criterion_marks
        where submission_id = $1 and question_id = $2 and provenance = 'teacher' limit 1`,
      [submissionId, questionId],
    )
    if (teacherRows.length > 0) {
      throw new Error("A teacher has marked this question; its old mark cannot replace that.")
    }

    await client.query(
      `insert into submission_question_marks (submission_id, question_id, awarded, available, provenance)
       values ($1, $2, $3, $4, 'legacy')
       on conflict (submission_id, question_id) do update
         set awarded = excluded.awarded, available = excluded.available,
             provenance = 'legacy', updated_at = timezone('utc', now())`,
      [submissionId, questionId, awarded, available],
    )
    await client.query(
      "delete from submission_question_criterion_marks where submission_id = $1 and question_id = $2",
      [submissionId, questionId],
    )
    await client.query(
      `insert into submission_question_criterion_marks
         (submission_id, question_id, success_criteria_id, awarded, available,
          why_not_awarded, how_to_improve, provenance)
       select $1, c.question_id, c.success_criteria_id, $3, $4, $5, $6, 'legacy'
         from activity_question_criteria c
        where c.question_id = $2`,
      [submissionId, questionId, awarded, available, whyNotAwarded?.trim() || null, howToImprove?.trim() || null],
    )

    await recomputeAssessmentSubmission(client, submissionId)
    return readTotals(client, submissionId)
  })
}

async function inTransaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  return withDbClient(async (client) => {
    await client.query("BEGIN")
    try {
      const result = await fn(client)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  })
}

async function readTotals(db: Queryable, submissionId: string): Promise<AssessmentSubmissionTotals | null> {
  const { rows } = await db.query<{ marks: number | null; max_marks: number; score: string | null }>(
    `select (s.body::jsonb ->> 'marks')::int as marks, a.max_marks, s.body::jsonb ->> 'score' as score
       from submissions s join activities a on a.activity_id = s.activity_id
      where s.submission_id = $1`,
    [submissionId],
  )
  const row = rows[0]
  if (!row || row.marks === null) return null
  return { awarded: Number(row.marks), available: Number(row.max_marks), score: Number(row.score) }
}

// Body keys this module owns. Whole-activity overrides go too: on a paper the
// total is always the questions'.
const CACHED_BODY_KEYS = [
  "marks", "ai_marks", "score", "ai_model_score", "sc_marks_awarded", "sc_marks_available",
  "success_criteria_scores", "questions",
]
const OVERRIDE_BODY_KEYS = [
  "marks_override", "teacher_override_score", "override_score", "teacher_ai_marks", "teacher_ai_score",
]

/**
 * Rebuild everything derived from a submission's question marks. The caller
 * holds the submission's row lock (or is otherwise the only writer).
 *
 * 1. Each question row: Σ of its criterion rows once any of them is an AI or
 *    teacher mark (a missing criterion counts 0); an unsplit legacy question
 *    keeps its old mark; a question with no rows at all has no mark.
 * 2. submissions.body: marks = Σ questions (an unmarked question counts 0),
 *    score = marks / max_marks, written to every key the score functions read
 *    (compute_submission_marks reads marks/ai_marks, compute_submission_base_score
 *    reads score or ai_model_score), with each question cached in `questions`.
 *    sc_marks_awarded/available hold the paper's totals, not the sum of the
 *    criteria, which double-counts a legacy question.
 * 3. submission_sc_marks, one row per criterion on the activity: Σ awarded over
 *    that criterion's rows across the questions, out of Σ of its marks
 *    available (a question not yet marked counts 0 out of the allocation).
 *    Provenance teacher if any row is, else ai if any is, else legacy.
 *
 * A submission with no question marks at all is left unmarked: the cached keys
 * are removed and so are its criterion rows.
 */
export async function recomputeAssessmentSubmission(
  db: Queryable,
  submissionId: string,
): Promise<AssessmentSubmissionTotals | null> {
  const { rows: activityRows } = await db.query<{ activity_id: string; max_marks: number }>(
    `select a.activity_id, a.max_marks
       from submissions s join activities a on a.activity_id = s.activity_id
      where s.submission_id = $1`,
    [submissionId],
  )
  const activity = activityRows[0]
  if (!activity) return null

  // 1. Question rows from criterion rows.
  await db.query(
    `with q as (
       select aq.question_id, aq.max_marks,
              (select sum(cm.awarded)::int from submission_question_criterion_marks cm
                where cm.submission_id = $1 and cm.question_id = aq.question_id) as awarded,
              (select count(*) from submission_question_criterion_marks cm
                where cm.submission_id = $1 and cm.question_id = aq.question_id) as rows,
              (select bool_or(cm.provenance = 'teacher') from submission_question_criterion_marks cm
                where cm.submission_id = $1 and cm.question_id = aq.question_id) as any_teacher,
              (select bool_or(cm.provenance <> 'legacy') from submission_question_criterion_marks cm
                where cm.submission_id = $1 and cm.question_id = aq.question_id) as any_marked,
              qm.provenance as current_provenance
         from activity_questions aq
         left join submission_question_marks qm
           on qm.submission_id = $1 and qm.question_id = aq.question_id
        where aq.activity_id = $2
     ),
     summed as (
       insert into submission_question_marks (submission_id, question_id, awarded, available, provenance)
       select $1, q.question_id, least(q.awarded, q.max_marks), q.max_marks,
              case when q.any_teacher then 'teacher' when q.any_marked then 'ai' else 'legacy' end
         from q
        where q.rows > 0
          and (q.any_marked or q.current_provenance is distinct from 'legacy')
       on conflict (submission_id, question_id) do update
         set awarded = excluded.awarded, available = excluded.available,
             provenance = excluded.provenance, updated_at = timezone('utc', now())
         where (submission_question_marks.awarded, submission_question_marks.available,
                submission_question_marks.provenance)
               is distinct from (excluded.awarded, excluded.available, excluded.provenance)
     )
     delete from submission_question_marks m
      using q
      where m.submission_id = $1 and m.question_id = q.question_id
        and q.rows = 0 and m.provenance <> 'legacy'`,
    [submissionId, activity.activity_id],
  )

  const { rows: questionRows } = await db.query<{
    question_id: string
    label: string
    max_marks: number
    awarded: number | null
    provenance: QuestionMarkProvenance | null
  }>(
    `select aq.question_id, aq.label, aq.max_marks, qm.awarded, qm.provenance
       from activity_questions aq
       left join submission_question_marks qm
         on qm.submission_id = $1 and qm.question_id = aq.question_id
      where aq.activity_id = $2
      order by aq.position, aq.label`,
    [submissionId, activity.activity_id],
  )

  const marked = questionRows.filter((row) => row.awarded !== null)
  if (marked.length === 0) {
    await db.query(
      `update submissions set body = ((coalesce(body::jsonb, '{}'::jsonb) - $2::text[]))::json
        where submission_id = $1`,
      [submissionId, CACHED_BODY_KEYS],
    )
    await db.query("delete from submission_sc_marks where submission_id = $1", [submissionId])
    return null
  }

  // 2. Criterion roll-up across questions.
  const { rows: criterionRows } = await db.query<{
    success_criteria_id: string
    awarded: number
    available: number
    provenance: QuestionMarkProvenance
    feedback: string | null
    teacher_feedback: string | null
  }>(
    `select c.success_criteria_id,
            coalesce(sum(cm.awarded), 0)::int as awarded,
            sum(coalesce(cm.available, c.max_marks))::int as available,
            case when bool_or(cm.provenance = 'teacher') then 'teacher'
                 when bool_or(cm.provenance = 'ai') then 'ai'
                 else 'legacy' end as provenance,
            string_agg(q.label || ': ' || nullif(concat_ws(' ', cm.why_not_awarded, cm.how_to_improve), ''),
                       E'\\n' order by q.position) as feedback,
            string_agg(q.label || ': ' || cm.teacher_feedback, E'\\n' order by q.position)
              filter (where cm.teacher_feedback is not null) as teacher_feedback
       from activity_questions q
       join activity_question_criteria c on c.question_id = q.question_id
       left join submission_question_criterion_marks cm
         on cm.submission_id = $1 and cm.question_id = c.question_id
        and cm.success_criteria_id = c.success_criteria_id
      where q.activity_id = $2
      group by c.success_criteria_id
      order by c.success_criteria_id`,
    [submissionId, activity.activity_id],
  )

  const maxMarks = Math.max(1, Number(activity.max_marks))
  const awarded = Math.min(
    maxMarks,
    marked.reduce((sum, row) => sum + Number(row.awarded), 0),
  )
  const score = Math.round((awarded / maxMarks) * 10000) / 10000

  const criterionScores: Record<string, number> = {}
  for (const row of criterionRows) {
    criterionScores[row.success_criteria_id] = Number(row.available) > 0
      ? Number(row.awarded) / Number(row.available)
      : 0
  }

  const questionsCache = questionRows.map((row) => ({
    questionId: row.question_id,
    label: row.label,
    awarded: row.awarded === null ? null : Number(row.awarded),
    available: Number(row.max_marks),
    provenance: row.provenance,
  }))

  await db.query(
    `update submissions
        set body = ((coalesce(body::jsonb, '{}'::jsonb) - $7::text[])
                    || jsonb_build_object(
                         'marks', $2::int,
                         'ai_marks', $2::int,
                         'score', $3::numeric,
                         'ai_model_score', $3::numeric,
                         'sc_marks_awarded', $2::int,
                         'sc_marks_available', $4::int,
                         'success_criteria_scores', $5::jsonb,
                         'questions', $6::jsonb))::json
      where submission_id = $1`,
    [
      submissionId,
      awarded,
      score,
      maxMarks,
      JSON.stringify(criterionScores),
      JSON.stringify(questionsCache),
      OVERRIDE_BODY_KEYS,
    ],
  )

  // 3. submission_sc_marks mirrors the roll-up.
  await db.query(
    `delete from submission_sc_marks
      where submission_id = $1 and not (success_criteria_id = any($2::text[]))`,
    [submissionId, criterionRows.map((row) => row.success_criteria_id)],
  )
  for (const row of criterionRows) {
    await db.query(
      `insert into submission_sc_marks
         (submission_id, success_criteria_id, awarded, available, feedback, teacher_feedback, provenance, marked_at)
       values ($1, $2, $3, $4, $5, $6, $7, timezone('utc', now()))
       on conflict (submission_id, success_criteria_id) do update
         set awarded = excluded.awarded, available = excluded.available,
             feedback = excluded.feedback, teacher_feedback = excluded.teacher_feedback,
             provenance = excluded.provenance, marked_at = excluded.marked_at
         where (submission_sc_marks.awarded, submission_sc_marks.available, submission_sc_marks.feedback,
                submission_sc_marks.teacher_feedback, submission_sc_marks.provenance)
               is distinct from (excluded.awarded, excluded.available, excluded.feedback,
                                 excluded.teacher_feedback, excluded.provenance)`,
      [
        submissionId,
        row.success_criteria_id,
        Number(row.awarded),
        Number(row.available),
        row.feedback,
        row.teacher_feedback,
        row.provenance,
      ],
    )
  }

  return { awarded, available: maxMarks, score }
}
