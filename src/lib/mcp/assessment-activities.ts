import { z } from 'zod'

import { query } from '@/lib/db'
import { isPowerPointAssessmentType, isQuestionMarkedActivityType } from '@/dino.config'
import { countFrontSheetChecks } from '@/lib/assessment-paper/files'
import { readAssessmentPaperResult } from '@/lib/assessment-paper/results'
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
import { describePresentationSections, filterPresentationSections } from '@/lib/pptx/describe'
import { PRESENTATION_SECTION_KEYS, isPresentationSectionSelector } from '@/lib/pptx/section-selectors'
import type { QuestionEvidence } from '@/lib/powerpoint-assessment/evidence-spec'
import { handInPowerPointAssessment, listSuppliedImages } from '@/lib/powerpoint-assessment/files'
import { evidenceFromRow, evidenceWarnings, type EvidenceKind, type SlotEvidence } from '@/lib/powerpoint-assessment/reading'
import { pupilMembershipSql } from '@/lib/roles/pupil-membership'
import { AssessmentPaperActivityBodySchema, PowerPointAssessmentActivityBodySchema, type PowerPointUploadSlot } from '@/types'

// MCP reads and settings for assessment-paper and PowerPoint assessment
// activities. The questions are set through setAssessmentQuestions and the
// files through the upload links; this is the rest: the questions' input
// shape, the overview, one pupil's result, a teacher's marks on one question,
// the script behind a script download link, and (PowerPoint) what the reader
// made of a pupil's files and a teacher's hand-in for a pupil.

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
    evidence: jsonArray(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        'PowerPoint assessments only: where the marker finds this question\'s evidence, a list of sources '
        + '({ source: "presentation", slot, sections?, required? } | { source: "slide_images", slot, slides? } | { source: "file", slot, required? } '
        + '| { source: "evidence_section", slot, heading?, want: "screenshots" | "text" | "both", required? } | { source: "reference_file", fileName }). '
        + 'Omit to keep the current sources; [] clears them. Refused on an assessment paper.',
      ),
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
    ...(q.evidence === undefined ? {} : { evidence: q.evidence }),
    criteria: q.criteria.map((c) => ({ successCriteriaId: c.success_criteria_id, maxMarks: c.max_marks })),
  }))
}

type ActivityRow = { activity_id: string; lesson_id: string; title: string | null; type: string | null; max_marks: number | null; body_data: unknown }

async function readActivity(activityId: string): Promise<ActivityRow> {
  const { rows } = await query<ActivityRow>(
    'select activity_id, lesson_id, title, type, max_marks, body_data from activities where activity_id = $1',
    [activityId],
  )
  const row = rows[0]
  if (!row) throw new Error(`Activity ${activityId} not found`)
  if (!isQuestionMarkedActivityType(row.type)) throw new Error(`Activity ${activityId} is not an assessment paper or PowerPoint assessment`)
  return row
}

async function readPowerPointActivity(activityId: string): Promise<ActivityRow> {
  const row = await readActivity(activityId)
  if (!isPowerPointAssessmentType(row.type)) throw new Error(`Activity ${activityId} is not a PowerPoint assessment`)
  return row
}

function uploadSlotsOf(bodyData: unknown): PowerPointUploadSlot[] {
  const parsed = PowerPointAssessmentActivityBodySchema.safeParse(bodyData ?? {})
  return parsed.success ? parsed.data.uploadSlots : []
}

function describePowerPointBody(bodyData: unknown) {
  const parsed = PowerPointAssessmentActivityBodySchema.safeParse(bodyData ?? {})
  const body = parsed.success ? parsed.data : null
  return {
    has_question_paper: Boolean(body?.questionPaperPath),
    has_mark_scheme: Boolean(body?.markSchemePath),
    instructions: body?.instructions ?? null,
    upload_slots: (body?.uploadSlots ?? []).map((slot) => ({
      key: slot.key,
      label: slot.label,
      kind: slot.kind,
      required: slot.required,
      hint: slot.hint ?? null,
    })),
    evidence_template_file: body?.evidenceTemplateFile ?? null,
    /** Absent means shown. */
    show_mark_scheme_to_pupils: body?.showMarkSchemeToPupils !== false,
    /** Why the body cannot be read (no upload slots set up), or null. */
    problem: parsed.success ? null : 'The upload slots are not set up.',
  }
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

async function readQuestionsWithCriteria(activityId: string, options?: { evidence?: boolean }) {
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
    ...(options?.evidence ? { evidence: q.evidence as QuestionEvidence[] } : {}),
    criteria: q.criteria.map((c) => ({
      success_criteria_id: c.successCriteriaId,
      description: descriptions.get(c.successCriteriaId) ?? '',
      max_marks: c.maxMarks,
    })),
  }))
}

type AssessmentActivityPupilBase = {
  pupil_id: string
  first_name: string | null
  last_name: string | null
  submission_id: string | null
  /** Null until marked; missing work still counts 0 towards progress. */
  marks_awarded: number | null
  max_marks: number
  mark_status: string | null
  mark_error: string | null
  progress: AssessmentActivityPupilProgress | null
}

/** A pupil on an assessment paper. */
export type AssessmentPaperActivityPupil = AssessmentActivityPupilBase & {
  script_uploaded: boolean
  script_uploaded_at: string | null
  /** 'passed', why the script is held, or null (no script, or a folded paper's, never checked). */
  front_sheet_check: string | null
}

/** One upload slot and the pupil's file in it. */
export type PowerPointPupilSlot = {
  slot_key: string
  label: string
  kind: string
  required: boolean
  /** Null while the slot is empty. */
  file: {
    file_id: string
    file_name: string
    bytes: number
    uploaded_at: string
    /** What the reader made of it: null until read, then "ok" or "error" (the file could not be read; the work is held). */
    reader_status: 'ok' | 'error' | null
    reader_error: string | null
  } | null
}

/** A pupil on a PowerPoint assessment. */
export type PowerPointActivityPupil = AssessmentActivityPupilBase & {
  handed_in: boolean
  handed_in_at: string | null
  files: PowerPointPupilSlot[]
  /** Labels of required slots with no file. */
  missing_required: string[]
}

export type AssessmentActivityPupil = AssessmentPaperActivityPupil | PowerPointActivityPupil

/** Where one pupil's latest work is in read-then-mark. Null with no submission. */
export type AssessmentActivityPupilProgress = {
  /** The script (or the handed-in files) has been read (answers stored) and no read is queued or running. */
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
  const questions = await readQuestionsWithCriteria(activityId, { evidence: isPowerPointAssessmentType(activity.type) })
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
    submission_status: string | null
    submitted_at: Date | null
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
       select distinct on (s.user_id) s.user_id, s.submission_id, s.body, s.mark_status, s.mark_error,
              s.submission_status, s.submitted_at
         from submissions s
        where s.activity_id = $1
        order by s.user_id, s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
     )
     select p.user_id as pupil_id, p.first_name, p.last_name,
            l.submission_id, (l.body::jsonb ->> 'marks')::int as marks, l.mark_status, l.mark_error,
            l.submission_status, l.submitted_at,
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

  const activitySummary = {
    activity_id: activity.activity_id,
    lesson_id: activity.lesson_id,
    title: activity.title,
    type: activity.type,
    max_marks: maxMarks,
  }
  const common = (p: (typeof pupils)[number]): AssessmentActivityPupilBase => ({
    pupil_id: p.pupil_id,
    first_name: p.first_name,
    last_name: p.last_name,
    submission_id: p.submission_id,
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
  })

  if (isPowerPointAssessmentType(activity.type)) {
    const slots = uploadSlotsOf(activity.body_data)
    const filesBySubmission = await readPowerPointFilesBySubmission(
      pupils.flatMap((p) => (p.submission_id ? [p.submission_id] : [])),
    )
    const powerPointPupils = pupils.map((p): PowerPointActivityPupil => {
      const handedIn = p.submission_status === 'submitted'
      const files = powerPointSlots(slots, filesBySubmission.get(p.submission_id ?? '') ?? [])
      return {
        ...common(p),
        handed_in: handedIn,
        handed_in_at: handedIn && p.submitted_at ? new Date(p.submitted_at).toISOString() : null,
        files,
        missing_required: files.filter((slot) => slot.required && !slot.file).map((slot) => slot.label),
      }
    })
    return {
      kind: 'powerpoint-assessment' as const,
      activity: activitySummary,
      body: describePowerPointBody(activity.body_data),
      // The task's images, as teachers and pupils see them (the reader's fingerprints are left out).
      supplied_images: (await listSuppliedImages(activityId)).map((image) => ({
        name: image.name,
        file_name: image.file_name,
        width: image.width,
        height: image.height,
        uploaded_at: image.uploaded_at,
      })),
      questions,
      handed_in_count: powerPointPupils.filter((p) => p.handed_in).length,
      pupils: powerPointPupils as AssessmentActivityPupil[],
    }
  }

  return {
    kind: 'assessment-paper' as const,
    activity: activitySummary,
    body: describeBody(activity.body_data),
    questions,
    scripts_count: pupils.filter((p) => p.uploaded_at).length,
    front_sheet_checks: await countFrontSheetChecks(activityId),
    pupils: pupils.map((p): AssessmentActivityPupil => ({
      ...common(p),
      script_uploaded: Boolean(p.uploaded_at),
      script_uploaded_at: p.uploaded_at ? new Date(p.uploaded_at).toISOString() : null,
      front_sheet_check: p.front_sheet_check,
    })),
  }
}

type PowerPointFileRow = {
  submission_id: string
  file_id: string
  slot_key: string
  original_name: string
  bytes: number
  uploaded_at: Date
  status: 'ok' | 'error' | null
  error: string | null
}

/** The files on these submissions, with the reader's status of each, by submission. */
async function readPowerPointFilesBySubmission(submissionIds: string[]): Promise<Map<string, PowerPointFileRow[]>> {
  const out = new Map<string, PowerPointFileRow[]>()
  if (submissionIds.length === 0) return out
  const { rows } = await query<PowerPointFileRow>(
    `select f.submission_id, f.file_id::text as file_id, f.slot_key, f.original_name, f.bytes, f.uploaded_at,
            e.status, e.error
       from practical_submission_files f
       left join practical_submission_evidence e on e.file_id = f.file_id
      where f.submission_id = any($1::text[])`,
    [submissionIds],
  )
  for (const row of rows) out.set(row.submission_id, [...(out.get(row.submission_id) ?? []), row])
  return out
}

/** Every upload slot, in the activity's order, with the file in it. */
function powerPointSlots(slots: PowerPointUploadSlot[], files: PowerPointFileRow[]): PowerPointPupilSlot[] {
  const fileOf = new Map(files.map((file) => [file.slot_key, file]))
  return slots.map((slot) => {
    const file = fileOf.get(slot.key)
    return {
      slot_key: slot.key,
      label: slot.label,
      kind: slot.kind,
      required: slot.required,
      file: file
        ? {
            file_id: file.file_id,
            file_name: file.original_name,
            bytes: Number(file.bytes),
            uploaded_at: new Date(file.uploaded_at).toISOString(),
            reader_status: file.status,
            reader_error: file.status === 'error' ? file.error : null,
          }
        : null,
    }
  })
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
    ai_awarded: number | null
  }>(
    `select question_id, success_criteria_id, awarded, available, why_not_awarded, how_to_improve,
            teacher_feedback, provenance, ai_awarded
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

  // A PowerPoint assessment's files and the marker's notes, as the results page reads them.
  const powerPoint = isPowerPointAssessmentType(activity.type)
    ? await readAssessmentPaperResult(activityId, pupilId, submissionId)
    : null
  const powerPointQuestion = new Map((powerPoint?.questions ?? []).map((q) => [q.questionId, q]))

  const maxMarks = Number(activity.max_marks) || 0
  return {
    activity_id: activityId,
    type: activity.type,
    pupil_id: pupilId,
    first_name: pupil.first_name,
    last_name: pupil.last_name,
    submission_id: submissionId,
    mark_status: submission?.mark_status ?? null,
    mark_error: submission?.mark_error ?? null,
    marks_awarded: submission?.marks ?? null,
    max_marks: maxMarks,
    // PowerPoint assessment: whether the pupil (or a teacher for them) handed in, and every
    // upload slot with its file and what the reader made of it. Null on an assessment paper.
    powerpoint: powerPoint?.powerpoint
      ? {
          handed_in: powerPoint.powerpoint.handedIn,
          files: powerPoint.powerpoint.files.map((file) => ({
            slot_key: file.slotKey,
            label: file.label,
            kind: file.kind,
            required: file.required,
            file_name: file.name,
            uploaded_at: file.uploadedAt,
            reader_status: file.evidenceStatus,
            reader_error: file.evidenceError,
          })),
          missing_headings: powerPoint.powerpoint.missingHeadings,
          warnings: powerPoint.powerpoint.warnings,
          unplaced_pictures: powerPoint.powerpoint.unplacedImages.length,
        }
      : null,
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
        ...(powerPoint
          ? {
              // Where the marker finds the question's evidence.
              evidence_sources: powerPointQuestion.get(q.question_id)?.evidenceSources ?? [],
              // The marker's note on the evidence it was given. Teacher-only: no pupil view shows it.
              marker_evidence: powerPointQuestion.get(q.question_id)?.markerEvidence ?? null,
            }
          : {}),
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
            // The AI marker's own mark, kept when a teacher changes it
            // (migration 141); null when the AI never marked it or it is not known.
            ai_awarded: row?.ai_awarded === null || row?.ai_awarded === undefined ? null : Number(row.ai_awarded),
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
    throw new Error(
      isPowerPointAssessmentType(activity.type)
        ? `Pupil ${input.pupilId} has no submission on this activity. Upload their files first.`
        : `Pupil ${input.pupilId} has no submission on this paper. Upload their script first.`,
    )
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
  if (isPowerPointAssessmentType(activity.type)) {
    throw new Error('PowerPoint assessments have no scripts; use get_practical_assessment_evidence or the results page.')
  }
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
 * The class, unit and assessment-paper or PowerPoint assessment activity a
 * class feedback PDF is for, each given by id or by name (exact id first,
 * then a case-insensitive exact name). The activity must be in one of the
 * unit's standard lessons, and the class must be set that lesson.
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
    throw new Error(`Activity ${activity.activity_id} is a ${activity.type ?? 'untyped'} activity, not an assessment paper or PowerPoint assessment.`)
  }

  const { rows: assigned } = await query(
    'select 1 from lesson_assignments where group_id = $1 and lesson_id = $2 limit 1',
    [groupId, activity.lesson_id],
  )
  if (!assigned[0]) {
    throw new Error(`Class ${groupId} is not set the lesson "${activity.lesson_title ?? activity.lesson_id}" that holds this activity.`)
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

// ------------------------------------------------------- PowerPoint assessments

/** What get_practical_assessment_evidence reports of one slot's reading. */
function describeSlotEvidence(evidence: SlotEvidence, sections: readonly string[] | null) {
  if (evidence.status === 'error') {
    return { status: 'error' as const, kind: evidence.kind, error: evidence.error, too_large: evidence.tooLarge === true }
  }
  const warnings = evidenceWarnings(evidence)
  if (evidence.kind === 'presentation') {
    const slides = evidence.slideImages
    return {
      status: 'ok' as const,
      kind: evidence.kind,
      slide_count: evidence.report.presentation.slideCount,
      // The presentation description section by section, as the marker is given it.
      sections: filterPresentationSections(describePresentationSections(evidence.report), sections).map((section) => ({
        key: section.key,
        title: section.title,
        text: section.text,
      })),
      // The slides drawn as pictures (for slide_images sources): slide numbers and sizes, never the pictures.
      slide_images: slides === null
        ? null
        : slides.status === 'ok'
          ? {
              status: 'ok' as const,
              slide_count: slides.slideCount,
              rendered: slides.images.map((image) => ({ slide: image.slide, width: image.width, height: image.height, bytes: image.bytes })),
              not_rendered: slides.notRendered,
            }
          : { status: 'unavailable' as const, reason: slides.reason },
      warnings,
    }
  }
  if (evidence.kind === 'pdf') {
    return {
      status: 'ok' as const,
      kind: evidence.kind,
      page_count: evidence.report.pageCount,
      text_chars: evidence.report.chars,
      text_truncated: evidence.report.truncated,
      warnings,
    }
  }
  const pictures = (images: { width: number; height: number; bytes: number }[]) =>
    images.map((image) => ({ width: image.width, height: image.height, bytes: image.bytes }))
  return {
    status: 'ok' as const,
    kind: evidence.kind,
    // Each heading the questions read that the pupil's document has: its text and how many pictures are under it.
    sections: evidence.report.sections.map((section) => ({
      label: section.label,
      heading: section.heading,
      text: section.text,
      images: section.images.length,
      image_sizes: pictures(section.images),
      not_shown: section.notShown,
    })),
    // Outside every heading: kept for the teacher, never marked.
    unplaced: {
      text: evidence.report.unplaced.text,
      images: evidence.report.unplaced.images.length,
      not_shown: evidence.report.unplaced.notShown,
    },
    missing_headings: evidence.report.missingHeadings,
    template: evidence.report.template ? { file_name: evidence.report.template.fileName, used: evidence.report.template.used } : null,
    warnings,
  }
}

/**
 * What the reader stored from one pupil's files on a PowerPoint assessment
 * (their latest submission), slot by slot: a presentation's description by
 * section and which slides were drawn, a PDF's page count and text length,
 * an evidence document's sections (text and picture counts) — never the
 * pictures themselves — and the warnings. `slot` narrows it to one slot;
 * `sections` narrows a presentation's description as a presentation
 * source's `sections` would.
 */
export async function getPracticalAssessmentEvidence(input: {
  activityId: string
  pupilId: string
  slot?: string | null
  sections?: string[] | null
}) {
  const activity = await readPowerPointActivity(input.activityId)
  const pupil = await readPupil(input.pupilId)
  const slots = uploadSlotsOf(activity.body_data)
  const slotKey = input.slot?.trim() || null
  if (slotKey && !slots.some((slot) => slot.key === slotKey)) {
    throw new Error(`No upload slot "${slotKey}" on this activity. Its slots are: ${slots.map((slot) => slot.key).join(', ') || 'none'}.`)
  }
  const sections = input.sections?.map((selector) => selector.trim()) ?? null
  const unknown = (sections ?? []).filter((selector) => !isPresentationSectionSelector(selector))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown presentation section${unknown.length === 1 ? '' : 's'}: ${unknown.map((u) => `"${u}"`).join(', ')}. `
      + `Use ${PRESENTATION_SECTION_KEYS.join(', ')}, or slides:N (e.g. slides:3,6).`,
    )
  }
  const submission = await readLatestSubmission(input.activityId, input.pupilId)
  const { rows } = submission
    ? await query<{
        file_id: string
        slot_key: string
        original_name: string
        bytes: number
        uploaded_at: Date
        kind: EvidenceKind | null
        status: 'ok' | 'error' | null
        error: string | null
        cache_key: string | null
        report: unknown
        extracted_at: Date | null
      }>(
        `select f.file_id::text as file_id, f.slot_key, f.original_name, f.bytes, f.uploaded_at,
                e.kind, e.status, e.error, e.cache_key, e.report, e.extracted_at
           from practical_submission_files f
           left join practical_submission_evidence e on e.file_id = f.file_id
          where f.submission_id = $1`,
        [submission.submission_id],
      )
    : { rows: [] }
  const fileOf = new Map(rows.map((row) => [row.slot_key, row]))

  return {
    activity_id: activity.activity_id,
    pupil_id: input.pupilId,
    first_name: pupil.first_name,
    last_name: pupil.last_name,
    submission_id: submission?.submission_id ?? null,
    mark_status: submission?.mark_status ?? null,
    mark_error: submission?.mark_error ?? null,
    slots: slots
      .filter((slot) => !slotKey || slot.key === slotKey)
      .map((slot) => {
        const row = fileOf.get(slot.key)
        return {
          slot_key: slot.key,
          label: slot.label,
          kind: slot.kind,
          required: slot.required,
          file: row
            ? {
                file_id: row.file_id,
                file_name: row.original_name,
                bytes: Number(row.bytes),
                uploaded_at: new Date(row.uploaded_at).toISOString(),
              }
            : null,
          // Null until the reader has read the file.
          read: row?.kind && row.status
            ? {
                read_at: row.extracted_at ? new Date(row.extracted_at).toISOString() : null,
                cache_key: row.cache_key,
                ...describeSlotEvidence(
                  evidenceFromRow(row.kind, {
                    status: row.status,
                    error: row.error,
                    cache_key: row.cache_key ?? '',
                    report: row.report,
                    description: null,
                  }),
                  sections,
                ),
              }
            : null,
        }
      }),
  }
}

export type PracticalAssessmentEvidence = Awaited<ReturnType<typeof getPracticalAssessmentEvidence>>

/**
 * A teacher's Hand in for a pupil, as the app's hand-in action takes it from
 * a teacher: refused while a required slot is empty; marking starts. A
 * locked lesson does not stop staff (lesson-lock.ts). Handing in again does
 * nothing.
 */
export async function handInPowerPointAssessmentForPupil(input: { activityId: string; pupilId: string; teacherId: string | null }) {
  await readPowerPointActivity(input.activityId)
  await readPupil(input.pupilId)
  const result = await handInPowerPointAssessment(input.activityId, input.pupilId, {
    userId: input.teacherId ?? 'mcp',
    isTeacher: true,
  })
  return {
    activity_id: input.activityId,
    pupil_id: input.pupilId,
    submission_id: result.submissionId,
    already_handed_in: result.alreadyHandedIn,
    handed_in: result.state.handedIn,
    mark_status: result.state.markStatus,
  }
}
