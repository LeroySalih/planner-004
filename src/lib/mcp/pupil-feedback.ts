import { revalidatePath } from 'next/cache'

import { query } from '@/lib/db'
import { SCORABLE_ACTIVITY_TYPES } from '@/dino.config'
import { fetchPupilActivityFeedbackMap, selectLatestFeedbackEntry } from '@/lib/feedback/pupil-activity-feedback'
import {
  applyTeacherActivityOverride,
  applyTeacherScFeedback,
  applyTeacherScMark,
  getSubmissionRow,
  normaliseTimestamp,
} from '@/lib/feedback/teacher-feedback'
import { extractScoreFromSubmission } from '@/lib/scoring/activity-scores'
import { effectiveCriterionFeedback } from '@/lib/scoring/aggregate-sc-marks'
import { GroupItemsActivityBodySchema, MatcherActivityBodySchema, McqActivityBodySchema } from '@/types'

// Reads and edits a pupil's feedback the way the assignment results page does:
// overall feedback is the whole-activity override, criterion feedback is the
// per-criterion mark, and both go through the same shared functions as the
// page. Whether the pupil sees it is still decided by the assignment's
// feedback_visible switch, which these tools never change.

const OVERALL_FEEDBACK_MAX = 2000

export type FeedbackVisibility = {
  assigned: boolean
  visible_to_pupil: boolean
  assignments: Array<{ group_id: string | null; intervention: boolean; feedback_visible: boolean }>
}

export type CriterionFeedback = {
  success_criteria_id: string
  description: string
  sc_type: 'binary' | 'levelled'
  descriptors: string[]
  awarded: number
  available: number
  /** What the pupil is shown: the teacher's comment if set, otherwise the AI's. */
  feedback: string | null
  ai_feedback: string | null
  teacher_feedback: string | null
  provenance: string
}

export type ActivityFeedback = {
  activity_id: string
  type: string
  title: string | null
  max_marks: number
  submission_id: string | null
  submitted_at: string | null
  pupil_answer: string | null
  /** Per-item results for matcher and group-items activities. */
  answer_detail: unknown
  uploaded_files: string[]
  status: 'override' | 'auto' | 'missing'
  score: number | null
  marks_awarded: number | null
  teacher_feedback: string | null
  auto_feedback: string | null
  criteria: CriterionFeedback[]
}

async function assertPupil(pupilId: string) {
  const { rows } = await query('select 1 from profiles where user_id = $1 limit 1', [pupilId])
  if (!rows[0]) throw new Error(`Pupil ${pupilId} not found`)
}

export async function readFeedbackVisibility(pupilId: string, lessonId: string): Promise<FeedbackVisibility> {
  const { rows } = await query<{ group_id: string | null; intervention: boolean; feedback_visible: boolean | null }>(
    `select la.group_id, false as intervention, la.feedback_visible
       from lesson_assignments la
       join group_membership gm on gm.group_id = la.group_id and gm.user_id = $1
      where la.lesson_id = $2
     union all
     select ia.group_id, true, ia.feedback_visible
       from intervention_assignments ia
      where ia.pupil_id = $1 and ia.lesson_id = $2 and ia.active is not false`,
    [pupilId, lessonId],
  )
  const assignments = rows.map((row) => ({
    group_id: row.group_id,
    intervention: row.intervention,
    feedback_visible: row.feedback_visible === true,
  }))
  return {
    assigned: assignments.length > 0,
    visible_to_pupil: assignments.some((a) => a.feedback_visible),
    assignments,
  }
}

// Pasted images arrive inline as data URIs and can run to megabytes.
function stripInlineData(text: string | null): string | null {
  if (!text) return text
  return text.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{200,}/gi, '[inline image omitted]')
}

function uploadedFileNames(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  const names = new Set<string>()
  for (const key of ['fileName', 'upload_file_name']) {
    if (typeof record[key] === 'string' && record[key]) names.add(record[key] as string)
  }
  if (Array.isArray(record.uploaded_files)) {
    for (const file of record.uploaded_files) {
      if (typeof file === 'string') names.add(file)
      else if (file && typeof file === 'object' && typeof (file as { name?: unknown }).name === 'string') {
        names.add((file as { name: string }).name)
      }
    }
  }
  return [...names]
}

function questionMetadata(type: string, bodyData: unknown) {
  const metadata: Parameters<typeof extractScoreFromSubmission>[4] = { question: null, correctAnswer: null }
  if (type === 'multiple-choice-question') {
    const parsed = McqActivityBodySchema.safeParse(bodyData)
    if (parsed.success) {
      metadata.optionTextMap = Object.fromEntries(parsed.data.options.map((o) => [o.id, o.text?.trim() ?? o.id]))
    }
  } else if (type === 'matcher') {
    const parsed = MatcherActivityBodySchema.safeParse(bodyData)
    if (parsed.success) metadata.matcherPairs = parsed.data.pairs
  } else if (type === 'group-items') {
    const parsed = GroupItemsActivityBodySchema.safeParse(bodyData)
    if (parsed.success) {
      metadata.groupItemsGroups = parsed.data.groups
      metadata.groupItemsItems = parsed.data.items
    }
  }
  return metadata
}

async function readCriteria(submissionId: string): Promise<CriterionFeedback[]> {
  const { rows } = await query<{
    success_criteria_id: string
    description: string | null
    sc_type: string | null
    descriptors: string[] | null
    awarded: number
    available: number
    feedback: string | null
    teacher_feedback: string | null
    provenance: string
  }>(
    `select m.success_criteria_id, sc.description, sc.sc_type,
            coalesce(array(select d.descriptor from success_criteria_descriptors d
                           where d.success_criteria_id = sc.success_criteria_id
                           order by d.level_index), '{}') as descriptors,
            m.awarded, m.available, m.feedback, m.teacher_feedback, m.provenance
       from submission_sc_marks m
       join success_criteria sc on sc.success_criteria_id = m.success_criteria_id
      where m.submission_id = $1
      order by sc.order_index, sc.success_criteria_id`,
    [submissionId],
  )
  return rows.map((row) => ({
    success_criteria_id: row.success_criteria_id,
    description: row.description ?? '',
    sc_type: row.sc_type === 'levelled' ? 'levelled' : 'binary',
    descriptors: row.descriptors ?? [],
    awarded: Number(row.awarded),
    available: Number(row.available),
    feedback: effectiveCriterionFeedback(row),
    ai_feedback: row.feedback?.trim() || null,
    teacher_feedback: row.teacher_feedback?.trim() || null,
    provenance: row.provenance,
  }))
}

async function readActivityFeedback(
  pupilId: string,
  activity: { activity_id: string; type: string; title: string | null; max_marks: number | null; body_data: unknown },
  feedbackRows: Parameters<typeof selectLatestFeedbackEntry>[0],
): Promise<ActivityFeedback> {
  const maxMarks = Number(activity.max_marks) || 1
  const { data: submission, error } = await getSubmissionRow(activity.activity_id, pupilId, null)
  if (error) throw error

  const base: ActivityFeedback = {
    activity_id: activity.activity_id,
    type: activity.type,
    title: activity.title,
    max_marks: maxMarks,
    submission_id: null,
    submitted_at: null,
    pupil_answer: null,
    answer_detail: null,
    uploaded_files: [],
    status: 'missing',
    score: null,
    marks_awarded: null,
    teacher_feedback: null,
    auto_feedback: null,
    criteria: [],
  }
  if (!submission) return base

  const { rows: scRows } = await query<{ success_criteria_id: string }>(
    'select success_criteria_id from activity_success_criteria where activity_id = $1',
    [activity.activity_id],
  )
  const extracted = extractScoreFromSubmission(
    activity.type,
    submission.body,
    scRows.map((row) => row.success_criteria_id),
    maxMarks,
    questionMetadata(activity.type, activity.body_data),
  )

  // Same resolution as the results page: the latest teacher entry, then the
  // body's own fields.
  const teacherEntry = selectLatestFeedbackEntry(feedbackRows, 'teacher')
  const autoEntry = selectLatestFeedbackEntry(feedbackRows, ['ai', 'auto'])
  const submittedAt = normaliseTimestamp(submission.submitted_at)

  return {
    ...base,
    submission_id: submission.submission_id as string,
    submitted_at: submittedAt,
    pupil_answer: stripInlineData(extracted.pupilAnswer ?? null),
    answer_detail: extracted.matcherPairs ?? extracted.groupItemsResults ?? null,
    uploaded_files: uploadedFileNames(submission.body),
    status: typeof extracted.overrideScore === 'number' ? 'override'
      : typeof extracted.effectiveScore === 'number' ? 'auto'
      : 'missing',
    score: extracted.effectiveScore,
    marks_awarded: extracted.effectiveScore !== null ? Math.round(extracted.effectiveScore * maxMarks) : null,
    teacher_feedback: teacherEntry?.feedback_text?.trim() || extracted.feedback || null,
    auto_feedback: autoEntry?.feedback_text?.trim() || extracted.autoFeedback || null,
    criteria: await readCriteria(submission.submission_id as string),
  }
}

export async function getPupilLessonFeedback(pupilId: string, lessonId: string, activityId?: string) {
  await assertPupil(pupilId)
  const { rows: lessonRows } = await query<{ title: string }>('select title from lessons where lesson_id = $1 limit 1', [lessonId])
  if (!lessonRows[0]) throw new Error(`Lesson ${lessonId} not found`)

  const { rows: activities } = await query<{
    activity_id: string
    type: string
    title: string | null
    max_marks: number | null
    body_data: unknown
  }>(
    `select activity_id, type, title, max_marks, body_data
       from activities
      where lesson_id = $1 and active is not false and type = any($2::text[])
        and ($3::text is null or activity_id = $3)
      order by order_by asc nulls last, title asc`,
    [lessonId, SCORABLE_ACTIVITY_TYPES as unknown as string[], activityId ?? null],
  )
  if (activityId && !activities[0]) throw new Error(`Activity ${activityId} is not a marked activity in lesson ${lessonId}`)

  const { data: feedbackMap } = await fetchPupilActivityFeedbackMap({
    activityIds: activities.map((a) => a.activity_id),
    pupilIds: [pupilId],
  })

  const results: ActivityFeedback[] = []
  for (const activity of activities) {
    results.push(await readActivityFeedback(pupilId, activity, feedbackMap?.get(`${pupilId}::${activity.activity_id}`)))
  }

  return {
    pupil_id: pupilId,
    lesson_id: lessonId,
    lesson_title: lessonRows[0].title,
    feedback_visibility: await readFeedbackVisibility(pupilId, lessonId),
    activities: results,
  }
}

export type SetPupilFeedbackInput = {
  pupilId: string
  activityId: string
  successCriteriaId?: string
  marks?: number
  feedback?: string
}

export async function setPupilFeedback(teacherId: string | null, input: SetPupilFeedbackInput) {
  await assertPupil(input.pupilId)
  if (input.marks === undefined && input.feedback === undefined) {
    throw new Error('Nothing to change: pass marks and/or feedback')
  }
  if (input.marks !== undefined && (!Number.isInteger(input.marks) || input.marks < 0)) {
    throw new Error('marks must be a whole number of at least 0')
  }

  const { rows: activityRows } = await query<{
    activity_id: string
    lesson_id: string
    type: string
    title: string | null
    max_marks: number | null
    body_data: unknown
  }>(
    'select activity_id, lesson_id, type, title, max_marks, body_data from activities where activity_id = $1 limit 1',
    [input.activityId],
  )
  const activity = activityRows[0]
  if (!activity) throw new Error(`Activity ${input.activityId} not found`)
  if (!(SCORABLE_ACTIVITY_TYPES as readonly string[]).includes(activity.type)) {
    throw new Error(`Activity ${input.activityId} is a "${activity.type}" activity, which is not marked`)
  }

  const { data: submission, error } = await getSubmissionRow(activity.activity_id, input.pupilId, null)
  if (error) throw error

  if (input.successCriteriaId) {
    if (!submission) throw new Error('The pupil has not submitted this activity, so it has no criterion marks yet')
    const target = { submissionId: submission.submission_id as string, successCriteriaId: input.successCriteriaId }
    const result = input.marks !== undefined
      ? await applyTeacherScMark({ ...target, awarded: input.marks, feedback: input.feedback })
      : await applyTeacherScFeedback({ ...target, feedback: input.feedback ?? null })
    if (result.error) throw new Error(result.error)
  } else {
    if (input.feedback !== undefined && input.feedback.trim().length > OVERALL_FEEDBACK_MAX) {
      throw new Error(`Overall feedback is limited to ${OVERALL_FEEDBACK_MAX} characters`)
    }
    // The results page always saves marks and comment together. Whichever one
    // was not given keeps its current value rather than being cleared.
    const current = await getPupilLessonFeedback(input.pupilId, activity.lesson_id, activity.activity_id)
    const now = current.activities[0]
    const marks = input.marks ?? now?.marks_awarded ?? null
    if (marks === null) {
      throw new Error('The pupil has no mark for this activity yet, so pass marks along with the feedback')
    }
    const feedback = input.feedback !== undefined ? (input.feedback.trim() || null) : (now?.teacher_feedback ?? null)
    const outcome = await applyTeacherActivityOverride(
      {
        activityId: activity.activity_id,
        pupilId: input.pupilId,
        submissionId: (submission?.submission_id as string | undefined) ?? null,
        marksOverride: marks,
        feedback,
      },
      teacherId,
    )
    if (!outcome.success) throw new Error(outcome.error)
  }

  const visibility = await readFeedbackVisibility(input.pupilId, activity.lesson_id)
  for (const assignment of visibility.assignments) {
    if (assignment.group_id && !assignment.intervention) {
      revalidatePath(`/results/assignments/${assignment.group_id}__${activity.lesson_id}`)
    }
  }

  const after = await getPupilLessonFeedback(input.pupilId, activity.lesson_id, activity.activity_id)
  return { activity: after.activities[0], feedback_visibility: visibility }
}
