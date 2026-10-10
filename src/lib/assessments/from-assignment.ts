import { query } from '@/lib/db'
import {
  createAssessment,
  recordPupilResult,
  setAssessmentObjectives,
  setAssessmentQuestions,
  type AssessmentObjectiveInput,
  type AssessmentQuestionInput,
} from '@/lib/assessments/store'
import type { AssignmentResultMatrix } from '@/types'

/**
 * Turns an assignment's results into an assessment paper: one question per
 * scorable activity, objectives from the lesson's learning objectives, and each
 * pupil's marks and feedback as shown on the results page.
 *
 * The paper is keyed on the assignment (migration 113), so running this again
 * refreshes the same paper. Questions keep their label once made, objectives
 * are only ever added, and marks a teacher has edited on the paper survive —
 * recordPupilResult only overwrites imported marks.
 */

// Assignments do not reliably carry a correct answer (an upload or long answer
// has none), so the paper points back to DINO rather than printing a guess.
const CORRECT_ANSWER = 'see dino model answer'
const LABEL_MAX = 80

type LoRow = { learning_objective_id: string; title: string; curriculum_id: string | null }

export type AssignmentAssessmentSummary = {
  assessmentId: string
  created: boolean
  questions: number
  pupilsRecorded: number
  pupilErrors: string[]
}

function plainText(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > 0 ? text : null
}

function nextCode(used: Set<string>): string {
  let n = used.size + 1
  while (used.has(`LO${n}`)) n += 1
  used.add(`LO${n}`)
  return `LO${n}`
}

function uniqueLabel(base: string, used: Set<string>): string {
  let label = base.slice(0, LABEL_MAX).trim()
  for (let n = 2; used.has(label); n += 1) label = `${base.slice(0, LABEL_MAX - 4).trim()} (${n})`
  used.add(label)
  return label
}

/**
 * The comment each pupil should read per activity, keyed `activity::pupil`:
 * whichever of the teacher's and the AI's latest comments is newer (an empty
 * latest entry means that comment was cleared, so the other one is used),
 * followed by any per-criterion comments the teacher wrote, one per line.
 */
async function loadLatestFeedback(matrix: AssignmentResultMatrix): Promise<Map<string, string>> {
  const activityIds = matrix.activities.map((a) => a.activityId)
  const pupilIds = matrix.rows.map((r) => r.pupil.userId)
  const cells = matrix.rows.flatMap((r) => r.cells.filter((c) => c.submissionId))
  const keyBySubmission = new Map(cells.map((c) => [c.submissionId as string, `${c.activityId}::${c.pupilId}`]))

  const [{ rows: entries }, { rows: criteria }] = await Promise.all([
    query<{ activity_id: string; pupil_id: string; feedback_text: string | null; created_at: Date }>(
      `select distinct on (activity_id, pupil_id, source = 'teacher')
              activity_id, pupil_id, feedback_text, created_at
         from pupil_activity_feedback
        where activity_id = any($1::text[]) and pupil_id = any($2::text[])
        order by activity_id, pupil_id, source = 'teacher', created_at desc`,
      [activityIds, pupilIds],
    ),
    query<{ submission_id: string; description: string | null; teacher_feedback: string }>(
      `select m.submission_id, sc.description, m.teacher_feedback
         from submission_sc_marks m
         join success_criteria sc on sc.success_criteria_id = m.success_criteria_id
        where m.submission_id = any($1::text[])
          and nullif(trim(m.teacher_feedback), '') is not null
        order by sc.order_index, sc.success_criteria_id`,
      [[...keyBySubmission.keys()]],
    ),
  ])

  // Per key: the latest teacher entry and the latest AI entry.
  const latest = new Map<string, { text: string | null; at: number }[]>()
  for (const row of entries) {
    const key = `${row.activity_id}::${row.pupil_id}`
    latest.set(key, [...(latest.get(key) ?? []), { text: plainText(row.feedback_text), at: new Date(row.created_at).getTime() }])
  }

  // A submission with no feedback entry at all falls back to the comment on
  // the cell itself.
  const parts = new Map<string, string[]>()
  for (const cell of cells) {
    const key = `${cell.activityId}::${cell.pupilId}`
    const newest = (latest.get(key) ?? []).sort((a, b) => b.at - a.at).find((e) => e.text)?.text
    const text = newest ?? plainText(cell.feedback ?? cell.autoFeedback)
    if (text) parts.set(key, [text])
  }
  for (const row of criteria) {
    const key = keyBySubmission.get(row.submission_id)
    const text = plainText(row.teacher_feedback)
    if (!key || !text) continue
    parts.set(key, [...(parts.get(key) ?? []), row.description ? `${plainText(row.description)}: ${text}` : text])
  }
  return new Map([...parts].map(([key, list]) => [key, list.join('\n')]))
}

export async function syncAssessmentFromAssignment(
  matrix: AssignmentResultMatrix,
): Promise<AssignmentAssessmentSummary> {
  const groupId = matrix.assignment?.groupId
  const lessonId = matrix.assignment?.lessonId
  if (!groupId || !lessonId || !matrix.lesson) throw new Error('This lesson is not assigned to the class.')
  if (matrix.activities.length === 0) throw new Error('This lesson has no marked activities to put on a paper.')

  const activityIds = matrix.activities.map((a) => a.activityId)
  const [{ rows: lessonLos }, { rows: activityLos }, { rows: unitRows }, { rows: existingRows }] = await Promise.all([
    query<LoRow>(
      `select lo.learning_objective_id, lo.title, ao.curriculum_id
         from lessons_learning_objective llo
         join learning_objectives lo on lo.learning_objective_id = llo.learning_objective_id
         join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
        where llo.lesson_id = $1 and llo.active is not false
        order by llo.order_by, llo.order_index`,
      [lessonId],
    ),
    query<LoRow & { activity_id: string }>(
      `select distinct on (acs.activity_id, lo.learning_objective_id)
              acs.activity_id, lo.learning_objective_id, lo.title, ao.curriculum_id, sc.order_index
         from activity_success_criteria acs
         join success_criteria sc on sc.success_criteria_id = acs.success_criteria_id
         join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
         join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
        where acs.activity_id = any($1::text[])
        order by acs.activity_id, lo.learning_objective_id, sc.order_index`,
      [activityIds],
    ),
    query<{ curriculum_id: string | null }>(
      'select u.curriculum_id from lessons l join units u on u.unit_id = l.unit_id where l.lesson_id = $1',
      [lessonId],
    ),
    query<{ assessment_id: string }>(
      `select assessment_id::text as assessment_id from assessments
        where source_group_id = $1 and source_lesson_id = $2 and active`,
      [groupId, lessonId],
    ),
  ])

  // The lesson's own objectives first, in lesson order, then any an activity
  // reaches through its criteria that the lesson does not list.
  const los = new Map<string, LoRow>()
  for (const lo of [...lessonLos, ...activityLos]) {
    if (!los.has(lo.learning_objective_id)) los.set(lo.learning_objective_id, lo)
  }

  const curriculumId = unitRows[0]?.curriculum_id
    ?? [...los.values()].find((lo) => lo.curriculum_id)?.curriculum_id
    ?? null
  if (!curriculumId) {
    throw new Error("This lesson's unit has no curriculum, and none of its learning objectives belong to one.")
  }

  let assessmentId = existingRows[0]?.assessment_id ?? null
  const { rows: storedObjectives } = assessmentId
    ? await query<{ code: string; title: string; learning_objective_id: string | null }>(
      'select code, title, learning_objective_id from assessment_learning_objectives where assessment_id = $1 order by position',
      [assessmentId],
    )
    : { rows: [] }

  // Codes already on the paper are kept as they are, so a link the teacher
  // changed by hand is not undone; new objectives are appended.
  const usedCodes = new Set(storedObjectives.map((o) => o.code))
  const objectives: AssessmentObjectiveInput[] = storedObjectives.map((o) => ({ code: o.code }))
  const codeByLo = new Map<string, string>()
  for (const o of storedObjectives) {
    if (o.learning_objective_id) codeByLo.set(o.learning_objective_id, o.code)
  }
  for (const lo of los.values()) {
    if (codeByLo.has(lo.learning_objective_id)) continue
    // An objective from another curriculum cannot be linked to this paper, so
    // it is carried by title alone.
    const linkable = lo.curriculum_id === curriculumId
    const stored = linkable ? null : storedObjectives.find((o) => !o.learning_objective_id && o.title === lo.title)
    if (stored) {
      codeByLo.set(lo.learning_objective_id, stored.code)
      continue
    }
    const code = nextCode(usedCodes)
    codeByLo.set(lo.learning_objective_id, code)
    objectives.push({ code, title: lo.title, learningObjectiveId: linkable ? lo.learning_objective_id : null })
  }
  if (objectives.length === 0) {
    objectives.push({ code: nextCode(usedCodes), title: matrix.lesson.title || 'Lesson objectives', learningObjectiveId: null })
  }
  const fallbackCode = objectives[0].code!

  const firstLoByActivity = new Map<string, string>()
  const lessonOrder = [...los.keys()]
  for (const row of [...activityLos].sort(
    (a, b) => lessonOrder.indexOf(a.learning_objective_id) - lessonOrder.indexOf(b.learning_objective_id),
  )) {
    if (!firstLoByActivity.has(row.activity_id)) firstLoByActivity.set(row.activity_id, row.learning_objective_id)
  }

  let created = false
  if (assessmentId) {
    await setAssessmentObjectives(assessmentId, objectives)
  } else {
    const paper = await createAssessment({
      title: [matrix.lesson.unitTitle, matrix.lesson.title || 'Untitled lesson'].filter(Boolean).join(' - '),
      assessedOn: matrix.assignment?.startDate?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      curriculumId,
      groupIds: [groupId],
      objectives,
    })
    assessmentId = paper.assessment_id
    created = true
    await query(
      'update assessments set source_group_id = $2, source_lesson_id = $3 where assessment_id = $1',
      [assessmentId, groupId, lessonId],
    )
  }

  const { rows: storedQuestions } = await query<{
    label: string
    max_marks: number
    objective_code: string
    source_activity_id: string | null
  }>(
    `select q.label, q.max_marks, alo.code as objective_code, q.source_activity_id
       from assessment_questions q
       join assessment_learning_objectives alo on alo.assessment_lo_id = q.assessment_lo_id
      where q.assessment_id = $1
      order by q.position`,
    [assessmentId],
  )
  const labelByActivity = new Map(
    storedQuestions.filter((q) => q.source_activity_id).map((q) => [q.source_activity_id as string, q.label]),
  )
  const usedLabels = new Set(storedQuestions.map((q) => q.label))

  const questions: AssessmentQuestionInput[] = []
  const activityByLabel = new Map<string, string>()
  matrix.activities.forEach((activity, index) => {
    const lo = firstLoByActivity.get(activity.activityId)
    const label = labelByActivity.get(activity.activityId)
      ?? uniqueLabel(`Q${index + 1} ${activity.title || 'Untitled activity'}`, usedLabels)
    activityByLabel.set(label, activity.activityId)
    questions.push({
      label,
      maxMarks: activity.maxMarks,
      objectiveCode: (lo && codeByLo.get(lo)) || fallbackCode,
      correctAnswer: CORRECT_ANSWER,
    })
  })
  // A question whose activity has gone (or that a teacher added) stays, so its
  // marks are not lost.
  for (const q of storedQuestions) {
    if (activityByLabel.has(q.label)) continue
    questions.push({ label: q.label, maxMarks: q.max_marks, objectiveCode: q.objective_code })
  }

  await setAssessmentQuestions(assessmentId, questions)
  await query(
    `update assessment_questions q set source_activity_id = s.activity_id
       from unnest($2::text[], $3::text[]) as s(label, activity_id)
      where q.assessment_id = $1 and q.label = s.label`,
    [assessmentId, [...activityByLabel.keys()], [...activityByLabel.values()]],
  )

  const labelById = new Map([...activityByLabel].map(([label, activityId]) => [activityId, label]))
  const maxById = new Map(matrix.activities.map((a) => [a.activityId, a.maxMarks]))
  const feedbackByCell = await loadLatestFeedback(matrix)
  let pupilsRecorded = 0
  const pupilErrors: string[] = []
  for (const row of matrix.rows) {
    const marks = row.cells.flatMap((cell) => {
      const label = labelById.get(cell.activityId)
      const max = maxById.get(cell.activityId) ?? 1
      if (!label || !cell.submissionId) return []
      const raw = cell.marksAwarded ?? (cell.score === null ? null : Math.round(cell.score * max))
      if (raw === null || raw === undefined) return []
      const awarded = Math.min(Math.max(Math.round(raw), 0), max)
      return [{
        label,
        awarded,
        whyNotAwarded: null,
        howToImprove: feedbackByCell.get(`${cell.activityId}::${row.pupil.userId}`) ?? null,
      }]
    })
    if (marks.length === 0) continue
    try {
      await recordPupilResult({ assessmentId, pupilId: row.pupil.userId, marks })
      pupilsRecorded += 1
    } catch (error) {
      pupilErrors.push(`${row.pupil.displayName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { assessmentId, created, questions: matrix.activities.length, pupilsRecorded, pupilErrors }
}
