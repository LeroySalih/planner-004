import { z } from 'zod'

import { query } from '@/lib/db'
import { isQuestionMarkedActivityType } from '@/dino.config'
import { countFrontSheetChecks } from '@/lib/assessment-paper/files'
import {
  QUESTION_MARKINGS,
  confirmAssessmentQuestionMarks,
  listQuestionsAwaitingCheck,
  readAssessmentQuestions,
  setTeacherAnswerTranscription,
  setTeacherQuestionCriterionComment,
  setTeacherQuestionCriterionMark,
  type AssessmentQuestionInput,
  type QuestionMarking,
} from '@/lib/assessment-paper/store'
import { fetchPupilActivityFeedbackMap, selectLatestFeedbackEntry } from '@/lib/feedback/pupil-activity-feedback'
import { pupilMembershipSql } from '@/lib/roles/pupil-membership'
import { AssessmentPaperActivityBodySchema } from '@/types'

// MCP reads and settings for assessment-paper activities. The questions are
// set through setAssessmentQuestions and the files through the upload links;
// this is the rest: the questions' input shape, the overview, one pupil's
// result, a teacher's marks on one question, and the script behind a script
// download link.

// The MCP SDK sends every parameter as a string, and z.array() does not
// coerce one, so arrays are parsed first (CLAUDE.md, MCP gotchas).
const jsonArray = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? JSON.parse(v) : v), z.array(item))

/** set_assessment_activity_questions' `questions` parameter. */
export const AssessmentActivityQuestionsInput = jsonArray(
  z.object({
    label: z.string().min(1).describe('Label as printed, e.g. "Q1(a)".'),
    max_marks: z.coerce.number().int().min(1).describe('Marks available for the question.'),
    question_text: z.string().nullable().optional().describe('The question as printed (optional; helps the marker).'),
    mark_scheme: z
      .string()
      .nullable()
      .optional()
      .describe('This question\'s mark scheme. A question with none is not sent to the AI marker; it is held until it has one.'),
    marking: z
      .enum(QUESTION_MARKINGS as [QuestionMarking, ...QuestionMarking[]])
      .optional()
      .describe('Who marks it: "ai" (the default for a new question), "ai_check" (AI, then listed for the teacher to confirm) or "teacher" (never sent). Omit to keep the current setting.'),
    depends_on: z
      .string()
      .nullable()
      .optional()
      .describe('Error carried forward: the label of an EARLIER question whose answer the marker also sees. null or "" for none; omit to keep the current one.'),
    criteria: jsonArray(
      z.object({
        success_criteria_id: z.string().min(1).describe('A success criterion the question tests.'),
        max_marks: z.coerce.number().int().min(1).describe('This criterion\'s share of the question\'s marks.'),
      }),
    ).describe('The criteria the question tests, with their shares; at least one.'),
  }),
)

/** The tool's questions as setAssessmentQuestions takes them. */
export function toAssessmentQuestionInputs(
  questions: z.infer<typeof AssessmentActivityQuestionsInput>,
): AssessmentQuestionInput[] {
  return questions.map((q) => ({
    label: q.label,
    maxMarks: q.max_marks,
    questionText: q.question_text ?? null,
    markScheme: q.mark_scheme ?? null,
    ...(q.marking === undefined ? {} : { marking: q.marking }),
    ...(q.depends_on === undefined ? {} : { dependsOn: q.depends_on?.trim() || null }),
    criteria: q.criteria.map((c) => ({ successCriteriaId: c.success_criteria_id, maxMarks: c.max_marks })),
  }))
}

type ActivityRow = { activity_id: string; lesson_id: string; title: string | null; max_marks: number | null; body_data: unknown }

async function readActivity(activityId: string): Promise<ActivityRow> {
  const { rows } = await query<ActivityRow & { type: string | null }>(
    'select activity_id, lesson_id, title, type, max_marks, body_data from activities where activity_id = $1',
    [activityId],
  )
  const row = rows[0]
  if (!row) throw new Error(`Activity ${activityId} not found`)
  if (!isQuestionMarkedActivityType(row.type)) throw new Error(`Activity ${activityId} is not an assessment paper`)
  return row
}

function describeBody(bodyData: unknown) {
  const parsed = AssessmentPaperActivityBodySchema.safeParse(bodyData ?? {})
  const body = parsed.success ? parsed.data : {}
  return {
    has_question_paper: Boolean(body.questionPaperPath),
    has_mark_scheme: Boolean(body.markSchemePath),
    instructions: body.instructions ?? null,
  }
}

async function readQuestionsWithCriteria(activityId: string) {
  const questions = await readAssessmentQuestions(activityId)
  const ids = Array.from(new Set(questions.flatMap((q) => q.criteria.map((c) => c.successCriteriaId))))
  const { rows } = await query<{ success_criteria_id: string; description: string | null }>(
    'select success_criteria_id, description from success_criteria where success_criteria_id = any($1::text[])',
    [ids],
  )
  const descriptions = new Map(rows.map((row) => [row.success_criteria_id, row.description ?? '']))
  const labelOf = new Map(questions.map((q) => [q.questionId, q.label]))
  return questions.map((q) => ({
    question_id: q.questionId,
    label: q.label,
    max_marks: q.maxMarks,
    question_text: q.questionText,
    mark_scheme: q.markScheme,
    has_mark_scheme: Boolean(q.markScheme?.trim()),
    marking: q.marking,
    depends_on: q.dependsOnQuestionId ? labelOf.get(q.dependsOnQuestionId) ?? null : null,
    criteria: q.criteria.map((c) => ({
      success_criteria_id: c.successCriteriaId,
      description: descriptions.get(c.successCriteriaId) ?? '',
      max_marks: c.maxMarks,
    })),
  }))
}

export type AssessmentActivityPupil = {
  pupil_id: string
  first_name: string | null
  last_name: string | null
  submission_id: string | null
  script_uploaded: boolean
  script_uploaded_at: string | null
  /** 'passed', why the script is held, or null (no script, or a folded paper's, never checked). */
  front_sheet_check: string | null
  /** Null until marked; a missing paper still counts 0 towards progress. */
  marks_awarded: number | null
  max_marks: number
  mark_status: string | null
  mark_error: string | null
  progress: AssessmentActivityPupilProgress | null
}

/** Where one pupil's latest script is in read-then-mark. Null with no submission. */
export type AssessmentActivityPupilProgress = {
  /** The script has been read (answers stored) and no read is queued or running. */
  read_done: boolean
  /** Questions with marks from anyone (AI, teacher, or carried over from an old paper). */
  questions_marked: number
  /** Questions with a mark job queued or running. */
  questions_to_mark: number
  /** Read, not blank, not teacher-only, unmarked and not queued: waiting for a mark scheme or for Send held questions. */
  questions_held: number
  /** AI-marked questions waiting for the teacher to confirm (ai_check, sketches, unreadable answers). */
  questions_awaiting_check: number
}

/**
 * The activity and its files, its questions with each criterion's
 * allocation, and every pupil who sits it: roster pupils of the classes the
 * lesson is set to (and an intervention's pupil), plus anyone already holding
 * a submission. Each pupil's figures come from their latest attempt.
 */
export async function getAssessmentActivity(activityId: string) {
  const activity = await readActivity(activityId)
  const questions = await readQuestionsWithCriteria(activityId)
  const maxMarks = Number(activity.max_marks) || 0

  const { rows: pupils } = await query<{
    pupil_id: string
    first_name: string | null
    last_name: string | null
    submission_id: string | null
    marks: number | null
    mark_status: string | null
    uploaded_at: Date | null
    front_sheet_check: string | null
    mark_error: string | null
    answers: number
    read_open: boolean
    questions_marked: number
    questions_to_mark: number
    questions_held: number
  }>(
    `with sitting as (
       select gm.user_id as pupil_id
         from lesson_assignments la
         join group_membership gm on gm.group_id = la.group_id
        where la.lesson_id = $2 and ${pupilMembershipSql('gm')}
       union
       select ia.pupil_id from intervention_assignments ia
        where ia.lesson_id = $2 and ia.active is not false
       union
       select s.user_id from submissions s where s.activity_id = $1
     ),
     latest as (
       select distinct on (s.user_id) s.user_id, s.submission_id, s.body, s.mark_status, s.mark_error
         from submissions s
        where s.activity_id = $1
        order by s.user_id, s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
     )
     select p.user_id as pupil_id, p.first_name, p.last_name,
            l.submission_id, (l.body::jsonb ->> 'marks')::int as marks, l.mark_status, l.mark_error,
            sc.uploaded_at, sc.front_sheet_check,
            coalesce(progress.answers, 0) as answers,
            coalesce(progress.read_open, false) as read_open,
            coalesce(progress.questions_marked, 0) as questions_marked,
            coalesce(progress.questions_to_mark, 0) as questions_to_mark,
            coalesce(progress.questions_held, 0) as questions_held
       from sitting
       join profiles p on p.user_id = sitting.pupil_id
       left join latest l on l.user_id = p.user_id
       left join lateral (
         select s.uploaded_at, s.front_sheet_check from assessment_scripts s
          where s.activity_id = $1 and s.pupil_id = p.user_id
            and s.submission_id is not distinct from l.submission_id
          order by s.uploaded_at desc limit 1
       ) sc on true
       left join lateral (
         select (select count(*)::int from submission_question_answers a
                  where a.submission_id = l.submission_id) as answers,
                exists (select 1 from external_jobs j
                         where j.job_type = 'ai_read' and j.status in ('pending', 'processing')
                           and j.payload->>'submissionId' = l.submission_id) as read_open,
                (select count(distinct m.question_id)::int from submission_question_criterion_marks m
                  where m.submission_id = l.submission_id) as questions_marked,
                (select count(distinct j.payload->>'questionId')::int from external_jobs j
                  where j.job_type = 'ai_mark' and j.status in ('pending', 'processing')
                    and j.payload->>'submissionId' = l.submission_id) as questions_to_mark,
                (select count(*)::int
                   from activity_questions q
                   join submission_question_answers a
                     on a.submission_id = l.submission_id and a.question_id = q.question_id
                  where q.activity_id = $1 and q.marking <> 'teacher' and a.status <> 'blank'
                    and not exists (select 1 from submission_question_criterion_marks m
                                     where m.submission_id = l.submission_id and m.question_id = q.question_id)
                    and not exists (select 1 from external_jobs j
                                     where j.job_type = 'ai_mark' and j.status in ('pending', 'processing')
                                       and j.payload->>'submissionId' = l.submission_id
                                       and j.payload->>'questionId' = q.question_id::text)) as questions_held
          where l.submission_id is not null
       ) progress on true
      order by p.last_name nulls last, p.first_name nulls last, p.user_id`,
    [activityId, activity.lesson_id],
  )
  const awaitingCheck = new Map<string, number>()
  for (const row of await listQuestionsAwaitingCheck(activityId)) {
    awaitingCheck.set(row.submissionId, (awaitingCheck.get(row.submissionId) ?? 0) + 1)
  }

  return {
    activity: {
      activity_id: activity.activity_id,
      lesson_id: activity.lesson_id,
      title: activity.title,
      max_marks: maxMarks,
    },
    body: describeBody(activity.body_data),
    questions,
    scripts_count: pupils.filter((p) => p.uploaded_at).length,
    front_sheet_checks: await countFrontSheetChecks(activityId),
    pupils: pupils.map((p): AssessmentActivityPupil => ({
      pupil_id: p.pupil_id,
      first_name: p.first_name,
      last_name: p.last_name,
      submission_id: p.submission_id,
      script_uploaded: Boolean(p.uploaded_at),
      script_uploaded_at: p.uploaded_at ? new Date(p.uploaded_at).toISOString() : null,
      front_sheet_check: p.front_sheet_check,
      marks_awarded: p.marks === null ? null : Number(p.marks),
      max_marks: maxMarks,
      mark_status: p.mark_status,
      mark_error: p.mark_error,
      progress: p.submission_id
        ? {
            read_done: Number(p.answers) > 0 && !p.read_open,
            questions_marked: Number(p.questions_marked),
            questions_to_mark: Number(p.questions_to_mark),
            questions_held: Number(p.questions_held),
            questions_awaiting_check: awaitingCheck.get(p.submission_id) ?? 0,
          }
        : null,
    })),
  }
}

/**
 * One pupil's result: every question with its mark (null if not marked) and
 * each criterion within it, the overall feedback, and their script. From the
 * pupil's latest attempt.
 */
async function readPupil(pupilId: string) {
  const { rows } = await query<{ first_name: string | null; last_name: string | null }>(
    'select first_name, last_name from profiles where user_id = $1',
    [pupilId],
  )
  if (!rows[0]) throw new Error(`Pupil ${pupilId} not found`)
  return rows[0]
}

/** The pupil's latest attempt at the activity, or null if they have none. */
async function readLatestSubmission(activityId: string, pupilId: string) {
  const { rows } = await query<{ submission_id: string; marks: number | null; mark_status: string | null; mark_error: string | null }>(
    `select submission_id, (body::jsonb ->> 'marks')::int as marks, mark_status, mark_error
       from submissions
      where activity_id = $1 and user_id = $2
      order by attempt_number desc, submitted_at desc nulls last, submission_id desc
      limit 1`,
    [activityId, pupilId],
  )
  return rows[0] ?? null
}

export async function getAssessmentActivityResult(activityId: string, pupilId: string) {
  const activity = await readActivity(activityId)
  const pupil = await readPupil(pupilId)
  const submission = await readLatestSubmission(activityId, pupilId)
  const submissionId = submission?.submission_id ?? null

  const questions = await readQuestionsWithCriteria(activityId)
  const { rows: questionMarks } = await query<{ question_id: string; awarded: number; provenance: string }>(
    'select question_id, awarded, provenance from submission_question_marks where submission_id = $1',
    [submissionId],
  )
  const { rows: criterionMarks } = await query<{
    question_id: string
    success_criteria_id: string
    awarded: number
    available: number
    why_not_awarded: string | null
    how_to_improve: string | null
    teacher_feedback: string | null
    provenance: string
  }>(
    `select question_id, success_criteria_id, awarded, available, why_not_awarded, how_to_improve,
            teacher_feedback, provenance
       from submission_question_criterion_marks where submission_id = $1`,
    [submissionId],
  )
  const { rows: answerRows } = await query<{
    question_id: string
    kind: string
    transcription: string | null
    pages: number[] | null
    status: string
    provenance: string
  }>(
    `select question_id, kind, transcription, pages, status, provenance
       from submission_question_answers where submission_id = $1`,
    [submissionId],
  )
  const answerOf = new Map(answerRows.map((row) => [row.question_id, row]))
  const questionMark = new Map(questionMarks.map((row) => [row.question_id, row]))
  const criterionMark = new Map(criterionMarks.map((row) => [`${row.question_id}|${row.success_criteria_id}`, row]))

  const { rows: scriptRows } = await query<{ script_id: string; page_count: number; uploaded_at: Date; front_sheet_check: string | null }>(
    `select script_id::text, page_count, uploaded_at, front_sheet_check from assessment_scripts
      where activity_id = $1 and pupil_id = $2 and submission_id is not distinct from $3
      order by uploaded_at desc limit 1`,
    [activityId, pupilId, submissionId],
  )

  const { data: feedbackMap } = await fetchPupilActivityFeedbackMap({ activityIds: [activityId], pupilIds: [pupilId] })
  const feedbackRows = feedbackMap?.get(`${pupilId}::${activityId}`)

  const maxMarks = Number(activity.max_marks) || 0
  return {
    activity_id: activityId,
    pupil_id: pupilId,
    first_name: pupil.first_name,
    last_name: pupil.last_name,
    submission_id: submissionId,
    mark_status: submission?.mark_status ?? null,
    mark_error: submission?.mark_error ?? null,
    marks_awarded: submission?.marks ?? null,
    max_marks: maxMarks,
    script: scriptRows[0]
      ? {
          script_id: scriptRows[0].script_id,
          page_count: Number(scriptRows[0].page_count),
          uploaded_at: new Date(scriptRows[0].uploaded_at).toISOString(),
          front_sheet_check: scriptRows[0].front_sheet_check,
        }
      : null,
    overall_feedback: {
      teacher: selectLatestFeedbackEntry(feedbackRows, 'teacher')?.feedback_text?.trim() || null,
      ai: selectLatestFeedbackEntry(feedbackRows, ['ai', 'auto'])?.feedback_text?.trim() || null,
    },
    questions: questions.map((q) => {
      const mark = questionMark.get(q.question_id)
      const answer = answerOf.get(q.question_id)
      return {
        question_id: q.question_id,
        label: q.label,
        marking: q.marking,
        depends_on: q.depends_on,
        has_mark_scheme: q.has_mark_scheme,
        awarded: mark ? Number(mark.awarded) : null,
        available: q.max_marks,
        provenance: mark?.provenance ?? null,
        // What the reader found; null until the script is read. provenance
        // "teacher" = corrected by a teacher, kept on a re-read.
        answer: answer
          ? {
              status: answer.status,
              kind: answer.kind,
              transcription: answer.transcription,
              pages: (answer.pages ?? []).map(Number),
              provenance: answer.provenance,
            }
          : null,
        criteria: q.criteria.map((c) => {
          const row = criterionMark.get(`${q.question_id}|${c.success_criteria_id}`)
          return {
            success_criteria_id: c.success_criteria_id,
            description: c.description,
            awarded: row ? Number(row.awarded) : null,
            available: row ? Number(row.available) : c.max_marks,
            why_not_awarded: row?.why_not_awarded ?? null,
            how_to_improve: row?.how_to_improve ?? null,
            teacher_feedback: row?.teacher_feedback ?? null,
            provenance: row?.provenance ?? null,
          }
        }),
      }
    }),
  }
}

export type AssessmentActivityResult = Awaited<ReturnType<typeof getAssessmentActivityResult>>

/** set_assessment_activity_question_marks' `criteria` parameter. */
export const AssessmentQuestionMarksCriteriaInput = jsonArray(
  z.object({
    success_criteria_id: z.string().min(1).describe('A criterion the question tests (see get_assessment_activity_result).'),
    marks: z.coerce.number().int().min(0).optional().describe('Marks for this criterion, 0 to its share of the question. Omit to leave the mark and set only the comment.'),
    feedback: z
      .string()
      .optional()
      .describe('The teacher\'s comment on this criterion; "" clears it. Omit to keep the current comment.'),
  }),
)

export type AssessmentQuestionMarksInput = {
  activityId: string
  pupilId: string
  /** The question's label (case-insensitive, e.g. "q3") or its question_id. */
  question: string
  criteria?: Array<{ success_criteria_id: string; marks?: number; feedback?: string }>
  /** Replaces the reader's transcription; "" clears it. */
  transcription?: string
  /** Stamp the question's remaining AI marks teacher, unchanged. */
  confirm?: boolean
}

const MAX_FEEDBACK_LENGTH = 2000
const MAX_TRANSCRIPTION_LENGTH = 20000

/**
 * A teacher's marking of one question on a pupil's latest submission, as the
 * results page does it: a corrected transcription, then each criterion's mark
 * and/or comment, then Confirm. Everything is checked before anything is
 * written, so a call with one bad criterion changes nothing. Returns the
 * question as get_assessment_activity_result shows it, and the paper's total.
 */
export async function setAssessmentActivityQuestionMarks(input: AssessmentQuestionMarksInput) {
  const activity = await readActivity(input.activityId)
  await readPupil(input.pupilId)
  const submission = await readLatestSubmission(input.activityId, input.pupilId)
  if (!submission) {
    throw new Error(`Pupil ${input.pupilId} has no submission on this paper. Upload their script first.`)
  }
  const submissionId = submission.submission_id

  const questions = await readQuestionsWithCriteria(activity.activity_id)
  const given = input.question.trim()
  const question = questions.find((q) => q.question_id === given)
    ?? questions.find((q) => q.label.trim().toLowerCase() === given.toLowerCase())
  if (!question) {
    throw new Error(`No question "${given}" on this paper. Its questions are: ${questions.map((q) => q.label).join(', ') || 'none'}.`)
  }

  const criteria = input.criteria ?? []
  const transcription = input.transcription
  const confirm = input.confirm === true
  if (criteria.length === 0 && transcription === undefined && !confirm) {
    throw new Error('Nothing to change: give criteria, transcription or confirm.')
  }
  if (transcription !== undefined && transcription.length > MAX_TRANSCRIPTION_LENGTH) {
    throw new Error(`The transcription is over ${MAX_TRANSCRIPTION_LENGTH} characters.`)
  }

  const { rows: existing } = await query<{ success_criteria_id: string; provenance: string }>(
    `select success_criteria_id, provenance from submission_question_criterion_marks
      where submission_id = $1 and question_id = $2`,
    [submissionId, question.question_id],
  )
  const marked = new Set(existing.map((row) => row.success_criteria_id))
  const allocationOf = new Map(question.criteria.map((c) => [c.success_criteria_id, c.max_marks]))
  const seen = new Set<string>()
  for (const c of criteria) {
    const available = allocationOf.get(c.success_criteria_id)
    if (available === undefined) {
      throw new Error(
        `Question ${question.label} does not test criterion ${c.success_criteria_id}. `
        + `Its criteria are: ${question.criteria.map((qc) => qc.success_criteria_id).join(', ')}.`,
      )
    }
    if (seen.has(c.success_criteria_id)) throw new Error(`Criterion ${c.success_criteria_id} is given more than once.`)
    seen.add(c.success_criteria_id)
    if (c.marks === undefined && c.feedback === undefined) {
      throw new Error(`Criterion ${c.success_criteria_id}: give marks, feedback or both.`)
    }
    if (c.marks !== undefined && (!Number.isInteger(c.marks) || c.marks < 0 || c.marks > available)) {
      throw new Error(`Criterion ${c.success_criteria_id} on ${question.label}: marks must be a whole number from 0 to ${available}.`)
    }
    if (c.feedback !== undefined && c.feedback.length > MAX_FEEDBACK_LENGTH) {
      throw new Error(`Criterion ${c.success_criteria_id}: feedback is over ${MAX_FEEDBACK_LENGTH} characters.`)
    }
    if (c.marks === undefined && !marked.has(c.success_criteria_id)) {
      throw new Error(`Criterion ${c.success_criteria_id} on ${question.label} has no mark yet: give marks with the comment.`)
    }
  }
  if (confirm && !existing.some((row) => row.provenance !== 'legacy') && !criteria.some((c) => c.marks !== undefined)) {
    throw new Error(`Question ${question.label} has no marks to confirm yet.`)
  }

  if (transcription !== undefined) {
    await setTeacherAnswerTranscription(submissionId, question.question_id, transcription.trim() || null)
  }
  for (const c of criteria) {
    if (c.marks !== undefined) {
      await setTeacherQuestionCriterionMark(submissionId, question.question_id, c.success_criteria_id, c.marks, c.feedback)
    } else {
      await setTeacherQuestionCriterionComment(submissionId, question.question_id, c.success_criteria_id, c.feedback ?? null)
    }
  }
  if (confirm) await confirmAssessmentQuestionMarks(submissionId, question.question_id)

  const result = await getAssessmentActivityResult(activity.activity_id, input.pupilId)
  return {
    activity_id: result.activity_id,
    pupil_id: result.pupil_id,
    submission_id: result.submission_id,
    marks_awarded: result.marks_awarded,
    max_marks: result.max_marks,
    mark_status: result.mark_status,
    question: result.questions.find((q) => q.question_id === question.question_id)!,
  }
}

export type LatestScript = {
  scriptId: string
  activityId: string
  activityTitle: string | null
  lessonId: string
  pupilId: string
  frontSheetCheck: string | null
  pageCount: number
  uploadedAt: string
  fileName: string
}

// storeScript only takes PDFs, but a script folded in from the old
// assessments module (attachLegacyScript) may be a JPEG or PNG.
const SCRIPT_CONTENT_TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' }

/** The extension and content type of a stored script, from its original_path. */
export function scriptFormat(originalPath: string): { extension: string; contentType: string } {
  const extension = originalPath.match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  const contentType = SCRIPT_CONTENT_TYPES[extension]
  return contentType ? { extension, contentType } : { extension: 'pdf', contentType: 'application/pdf' }
}

/** `<activity title> - <pupil name>.<extension>`, with characters a file system refuses taken out. */
export function scriptFileName(
  activityTitle: string | null,
  firstName: string | null,
  lastName: string | null,
  extension = 'pdf',
): string {
  const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  const title = clean(activityTitle ?? '').slice(0, 80).trim() || 'Assessment'
  const name = clean(`${firstName ?? ''} ${lastName ?? ''}`).slice(0, 80).trim() || 'pupil'
  return `${title} - ${name}.${extension}`
}

/**
 * The newest script on the pupil's latest submission of an assessment-paper
 * activity, held or not, for a teacher's download of the original PDF.
 */
export async function resolveLatestScript(activityId: string, pupilId: string): Promise<LatestScript> {
  const activity = await readActivity(activityId)
  const pupil = await readPupil(pupilId)
  const submission = await readLatestSubmission(activityId, pupilId)
  if (!submission) throw new Error(`Pupil ${pupilId} has no submission on this paper.`)
  const { rows } = await query<{
    script_id: string
    original_path: string
    page_count: number
    uploaded_at: Date
    front_sheet_check: string | null
  }>(
    `select script_id::text, original_path, page_count, uploaded_at, front_sheet_check from assessment_scripts
      where activity_id = $1 and pupil_id = $2 and submission_id = $3
      order by uploaded_at desc, script_id desc limit 1`,
    [activityId, pupilId, submission.submission_id],
  )
  const script = rows[0]
  if (!script) throw new Error(`Pupil ${pupilId} has no script uploaded on their latest submission of this paper.`)
  return {
    scriptId: script.script_id,
    activityId,
    activityTitle: activity.title,
    lessonId: activity.lesson_id,
    pupilId,
    frontSheetCheck: script.front_sheet_check,
    pageCount: Number(script.page_count),
    uploadedAt: new Date(script.uploaded_at).toISOString(),
    fileName: scriptFileName(activity.title, pupil.first_name, pupil.last_name, scriptFormat(script.original_path).extension),
  }
}

/** The stored file, its content type and download name for a script link, or null once the script has gone. */
export async function readScriptForDownload(scriptId: string, activityId: string) {
  const { rows } = await query<{ original_path: string; pupil_id: string; title: string | null; first_name: string | null; last_name: string | null }>(
    `select s.original_path, s.pupil_id, a.title, p.first_name, p.last_name
       from assessment_scripts s
       join activities a on a.activity_id = s.activity_id
       left join profiles p on p.user_id = s.pupil_id
      where s.script_id = $1::uuid and s.activity_id = $2`,
    [scriptId, activityId],
  )
  const row = rows[0]
  if (!row) return null
  const { extension, contentType } = scriptFormat(row.original_path)
  return {
    originalPath: row.original_path,
    pupilId: row.pupil_id,
    contentType,
    fileName: scriptFileName(row.title, row.first_name, row.last_name, extension),
  }
}

export type ClassFeedbackTarget = {
  groupId: string
  unitId: string
  unitTitle: string
  lessonId: string
  activityId: string
  activityTitle: string | null
}

/** Exactly one match, or an error naming the candidates so the caller can retry with an id. */
function onlyMatch<T>(what: string, given: string, matches: T[], describe: (match: T) => string, where = ''): T {
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) throw new Error(`No ${what} matches "${given}"${where}. Give its id or exact name.`)
  throw new Error(
    `More than one ${what} matches "${given}"${where}: ${matches.map(describe).join('; ')}. Retry with the id.`,
  )
}

/**
 * The class, unit and assessment-paper activity a class feedback PDF is for,
 * each given by id or by name (exact id first, then a case-insensitive exact
 * name). The activity must be an assessment paper in one of the unit's
 * standard lessons, and the class must be set that lesson.
 */
export async function resolveClassFeedbackTarget(input: {
  class: string
  unit: string
  activity: string
}): Promise<ClassFeedbackTarget> {
  const className = input.class.trim()
  const { rows: groups } = await query<{ group_id: string }>(
    `select group_id from groups
      where group_id = $1
         or (not exists (select 1 from groups where group_id = $1) and lower(group_id) = lower($1))
      order by group_id`,
    [className],
  )
  const { group_id: groupId } = onlyMatch('class', className, groups, (g) => g.group_id)

  const unitName = input.unit.trim()
  const { rows: units } = await query<{ unit_id: string; title: string | null }>(
    `select unit_id, title from units
      where unit_id = $1
         or (not exists (select 1 from units where unit_id = $1) and lower(trim(title)) = lower($1))
      order by unit_id`,
    [unitName],
  )
  const unit = onlyMatch('unit', unitName, units, (u) => `${u.title ?? 'untitled'} (${u.unit_id})`)

  const activityName = input.activity.trim()
  const { rows: activities } = await query<{
    activity_id: string
    title: string | null
    type: string | null
    lesson_id: string
    lesson_title: string | null
  }>(
    `with candidates as (
       select a.activity_id, a.title, a.type, l.lesson_id, l.title as lesson_title
         from activities a
         join lessons l on l.lesson_id = a.lesson_id
        where l.unit_id = $1 and l.kind = 'standard'
          and l.active is not false and a.active is not false
     )
     select * from candidates
      where activity_id = $2
         or (not exists (select 1 from candidates where activity_id = $2) and lower(trim(title)) = lower($2))
      order by lesson_title, title, activity_id`,
    [unit.unit_id, activityName],
  )
  const activity = onlyMatch(
    'activity',
    activityName,
    activities,
    (a) => `${a.title ?? 'untitled'} (${a.activity_id}, ${a.type ?? 'no type'}, lesson ${a.lesson_title ?? a.lesson_id})`,
    ` in a lesson of unit ${unit.unit_id}`,
  )
  if (!isQuestionMarkedActivityType(activity.type)) {
    throw new Error(`Activity ${activity.activity_id} is a ${activity.type ?? 'untyped'} activity, not an assessment paper.`)
  }

  const { rows: assigned } = await query(
    'select 1 from lesson_assignments where group_id = $1 and lesson_id = $2 limit 1',
    [groupId, activity.lesson_id],
  )
  if (!assigned[0]) {
    throw new Error(`Class ${groupId} is not set the lesson "${activity.lesson_title ?? activity.lesson_id}" that holds this paper.`)
  }

  return {
    groupId,
    unitId: unit.unit_id,
    unitTitle: unit.title?.trim() || unit.unit_id,
    lessonId: activity.lesson_id,
    activityId: activity.activity_id,
    activityTitle: activity.title,
  }
}
