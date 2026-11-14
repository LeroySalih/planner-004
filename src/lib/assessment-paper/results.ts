import "server-only"

import { query } from "@/lib/db"
import { isAssessmentPaperType, isPowerPointAssessmentType, isQuestionMarkedActivityType } from "@/dino.config"
import {
  listQuestionsAwaitingCheck,
  readAssessmentQuestions,
  readSubmissionAnswers,
  type QuestionMarking,
  type QuestionMarkProvenance,
  type SubmissionQuestionAnswer,
} from "@/lib/assessment-paper/store"
import { ASSESSMENT_SCRIPTS_BUCKET, pupilHasSatAssessment } from "@/lib/assessment-paper/files"
import { assessmentFeedbackPdfUrl } from "@/lib/assessment-paper/urls"
import { fetchPupilActivityFeedbackMap, selectLatestFeedbackEntry } from "@/lib/feedback/pupil-activity-feedback"
import { readFeedbackVisibility } from "@/lib/mcp/pupil-feedback"
import { evidenceHeading, type QuestionEvidence } from "@/lib/powerpoint-assessment/evidence-spec"
import {
  evidenceFromRow,
  evidenceLabelKey,
  evidenceWarnings,
  type EvidenceKind,
  type SlotEvidence,
  type StoredEvidenceImage,
} from "@/lib/powerpoint-assessment/reading"
import {
  AssessmentPaperActivityBodySchema,
  PowerPointAssessmentActivityBodySchema,
  type PowerPointUploadSlotKind,
} from "@/types"

// One pupil's result on an assessment paper, question by question, as the
// results page (teacher) and the feedback PDF read it, and the little the
// pupil's lesson page shows: the question paper once sat, then the overall
// marks and links. The question-by-question detail reaches a pupil only
// through the feedback PDF (feedback-pdf.ts).

export type AssessmentResultCriterion = {
  successCriteriaId: string
  description: string
  /** The criterion's share of the question's marks: what a teacher marks out of. */
  allocation: number
  /** Null until marked. */
  awarded: number | null
  /** Out of the allocation, except on an unsplit legacy question (the question's marks). */
  available: number
  whyNotAwarded: string | null
  howToImprove: string | null
  teacherFeedback: string | null
  provenance: QuestionMarkProvenance | null
  /**
   * The AI marker's own mark (migration 141), kept when a teacher changes
   * `awarded`. Null when the AI never marked it or its mark is not known.
   * Teacher views only: never pass it to a pupil.
   */
  aiAwarded: number | null
}

export type AssessmentResultQuestion = {
  questionId: string
  label: string
  questionText: string | null
  /** The question's marking setting. */
  marking: QuestionMarking
  /** Label of the earlier question this one carries error forward from. */
  dependsOnLabel: string | null
  hasMarkScheme: boolean
  markScheme: string | null
  /** What the reader found on the script; null until read. */
  answer: SubmissionQuestionAnswer | null
  /** Marked by the model and waiting for the teacher to confirm or change it. */
  awaitingCheck: boolean
  /** Null until marked; an unmarked question counts 0 in the total. */
  awarded: number | null
  available: number
  provenance: QuestionMarkProvenance | null
  criteria: AssessmentResultCriterion[]
  /**
   * PowerPoint assessment: where the question's evidence comes from
   * (evidence-spec.ts). [] on an assessment paper. Teacher views only.
   */
  evidenceSources: QuestionEvidence[]
  /**
   * PowerPoint assessment: the pictures the marker is given for this
   * question, from the files read: the screenshots under its evidence
   * headings and the slides drawn for it. Teacher views only.
   */
  evidenceImages: AssessmentEvidenceImage[]
  /** PowerPoint assessment: the marker's note on the evidence. Teacher views only: never pass it to a pupil. */
  markerEvidence: string | null
}

/** A picture the reader stored from a pupil's file (teacher-only /api/files URL). */
export type AssessmentEvidenceImage = {
  url: string
  caption: string
  width: number
  height: number
}

/** One upload slot of a PowerPoint assessment and the pupil's file in it. */
export type PowerPointResultFile = {
  slotKey: string
  label: string
  kind: PowerPointUploadSlotKind
  required: boolean
  /** The rest are null while the slot is empty. */
  name: string | null
  /** /api/files URL of the file as handed in. */
  url: string | null
  uploadedAt: string | null
  /** Null until the reader has read it. */
  evidenceStatus: "ok" | "error" | null
  evidenceError: string | null
}

/** A PowerPoint assessment's files on one submission, in place of a script. Teacher views only. */
export type PowerPointResultFiles = {
  handedIn: boolean
  files: PowerPointResultFile[]
  /** Evidence headings the questions read that are not in the pupil's evidence document. */
  missingHeadings: string[]
  /** What the reader noticed, each starting with its slot's label. */
  warnings: string[]
  /** Pictures outside every heading of an evidence document: kept for the teacher, never marked. */
  unplacedImages: AssessmentEvidenceImage[]
}

export type AssessmentScriptFiles = {
  scriptId: string
  pageCount: number
  uploadedAt: string
  /** /api/files URL of the script as uploaded. */
  originalUrl: string
  /** 'passed', why the script is held, or null if never checked (folded papers). */
  frontSheetCheck: string | null
  /** The markable pages (2..n), in order, as /api/files URLs. Teachers only. */
  pages: Array<{ pageNumber: number; url: string }>
}

export type AssessmentPaperResult = {
  activityId: string
  lessonId: string
  pupilId: string
  instructions: string | null
  maxMarks: number
  submissionId: string | null
  markStatus: string | null
  markError: string | null
  /** Null until any question is marked. */
  marksAwarded: number | null
  script: AssessmentScriptFiles | null
  /** A PowerPoint assessment's files; null on an assessment paper. */
  powerpoint: PowerPointResultFiles | null
  questions: AssessmentResultQuestion[]
  /** Questions awaiting a teacher's check on this pupil's script. */
  awaitingCheckCount: number
  /** The same across every pupil's latest script on the paper. */
  paperAwaitingCheck: { questions: number; pupils: number }
}

export function assessmentScriptUrl(storagePath: string): string {
  return `/api/files/${ASSESSMENT_SCRIPTS_BUCKET}/${storagePath.split("/").map(encodeURIComponent).join("/")}`
}

/**
 * The result on one submission (`submissionId`), or on the pupil's latest
 * attempt when it is omitted. A pupil with no submission gets the questions
 * unmarked and no script.
 */
export async function readAssessmentPaperResult(
  activityId: string,
  pupilId: string,
  submissionId?: string | null,
): Promise<AssessmentPaperResult> {
  const { rows: activityRows } = await query<{
    lesson_id: string
    type: string | null
    max_marks: number | null
    body_data: unknown
  }>("select lesson_id, type, max_marks, body_data from activities where activity_id = $1", [activityId])
  const activity = activityRows[0]
  if (!activity) throw new Error("Activity not found.")
  if (!isQuestionMarkedActivityType(activity.type)) throw new Error("This activity is not an assessment paper.")
  const body = AssessmentPaperActivityBodySchema.safeParse(activity.body_data ?? {})
  const isPowerPoint = isPowerPointAssessmentType(activity.type)

  const { rows: submissionRows } = await query<{
    submission_id: string
    marks: number | null
    mark_status: string | null
    mark_error: string | null
    submission_status: string | null
  }>(
    `select submission_id, (body::jsonb ->> 'marks')::int as marks, mark_status, mark_error, submission_status
       from submissions
      where activity_id = $1 and user_id = $2 and ($3::text is null or submission_id = $3)
      order by attempt_number desc, submitted_at desc nulls last, submission_id desc
      limit 1`,
    [activityId, pupilId, submissionId ?? null],
  )
  const submission = submissionRows[0] ?? null
  if (submissionId && !submission) throw new Error("Submission not found.")
  const resolvedSubmissionId = submission?.submission_id ?? null

  const questions = await readAssessmentQuestions(activityId)
  const criterionIds = Array.from(new Set(questions.flatMap((q) => q.criteria.map((c) => c.successCriteriaId))))

  const [descriptionRows, questionMarkRows, criterionMarkRows, scriptRows, answers, awaitingOnPaper, powerPointRead] = await Promise.all([
    query<{ success_criteria_id: string; description: string | null }>(
      "select success_criteria_id, description from success_criteria where success_criteria_id = any($1::text[])",
      [criterionIds],
    ),
    query<{ question_id: string; awarded: number; provenance: QuestionMarkProvenance }>(
      "select question_id, awarded, provenance from submission_question_marks where submission_id = $1",
      [resolvedSubmissionId],
    ),
    query<{
      question_id: string
      success_criteria_id: string
      awarded: number
      available: number
      why_not_awarded: string | null
      how_to_improve: string | null
      teacher_feedback: string | null
      provenance: QuestionMarkProvenance
      ai_awarded: number | null
    }>(
      `select question_id, success_criteria_id, awarded, available, why_not_awarded, how_to_improve,
              teacher_feedback, provenance, ai_awarded
         from submission_question_criterion_marks where submission_id = $1`,
      [resolvedSubmissionId],
    ),
    resolvedSubmissionId && !isPowerPoint
      ? query<{
          script_id: string
          page_count: number
          uploaded_at: Date
          original_path: string
          page_paths: string[] | null
          front_sheet_check: string | null
        }>(
          `select script_id::text as script_id, page_count, uploaded_at, original_path, page_paths, front_sheet_check
             from assessment_scripts
            where activity_id = $1 and pupil_id = $2 and submission_id = $3
            order by uploaded_at desc, script_id desc
            limit 1`,
          [activityId, pupilId, resolvedSubmissionId],
        )
      : Promise.resolve({ rows: [] as never[] }),
    resolvedSubmissionId
      ? readSubmissionAnswers(resolvedSubmissionId)
      : Promise.resolve(new Map<string, SubmissionQuestionAnswer>()),
    listQuestionsAwaitingCheck(activityId),
    isPowerPoint ? readPowerPointEvidence(resolvedSubmissionId) : Promise.resolve(null),
  ])
  const awaitingHere = new Set(
    awaitingOnPaper.filter((row) => row.submissionId === resolvedSubmissionId).map((row) => row.questionId),
  )
  const labelOf = new Map(questions.map((q) => [q.questionId, q.label]))

  const descriptionOf = new Map(descriptionRows.rows.map((row) => [row.success_criteria_id, row.description ?? ""]))
  const questionMark = new Map(questionMarkRows.rows.map((row) => [row.question_id, row]))
  const criterionMark = new Map(
    criterionMarkRows.rows.map((row) => [`${row.question_id}|${row.success_criteria_id}`, row]),
  )
  const script = scriptRows.rows[0]

  return {
    activityId,
    lessonId: activity.lesson_id,
    pupilId,
    instructions: body.success ? body.data.instructions ?? null : null,
    maxMarks: Number(activity.max_marks) || 0,
    submissionId: resolvedSubmissionId,
    markStatus: submission?.mark_status ?? null,
    markError: submission?.mark_error ?? null,
    marksAwarded: submission?.marks === null || submission?.marks === undefined ? null : Number(submission.marks),
    script: script
      ? {
          scriptId: script.script_id,
          pageCount: Number(script.page_count),
          uploadedAt: new Date(script.uploaded_at).toISOString(),
          originalUrl: assessmentScriptUrl(script.original_path),
          frontSheetCheck: script.front_sheet_check,
          pages: (script.page_paths ?? []).map((p) => ({
            pageNumber: Number.parseInt(p.match(/page-(\d+)\.png$/)?.[1] ?? "0", 10),
            url: assessmentScriptUrl(p),
          })),
        }
      : null,
    powerpoint: isPowerPoint
      ? powerPointFiles(activity.body_data, submission?.submission_status === "submitted", powerPointRead!, questions)
      : null,
    awaitingCheckCount: awaitingHere.size,
    paperAwaitingCheck: {
      questions: awaitingOnPaper.length,
      pupils: new Set(awaitingOnPaper.map((row) => row.submissionId)).size,
    },
    questions: questions.map((q) => {
      const mark = questionMark.get(q.questionId)
      return {
        questionId: q.questionId,
        label: q.label,
        questionText: q.questionText,
        marking: q.marking,
        dependsOnLabel: q.dependsOnQuestionId ? labelOf.get(q.dependsOnQuestionId) ?? null : null,
        hasMarkScheme: Boolean(q.markScheme?.trim()),
        markScheme: q.markScheme?.trim() || null,
        answer: answers.get(q.questionId) ?? null,
        awaitingCheck: awaitingHere.has(q.questionId),
        awarded: mark ? Number(mark.awarded) : null,
        available: q.maxMarks,
        provenance: mark?.provenance ?? null,
        criteria: q.criteria.map((c) => {
          const row = criterionMark.get(`${q.questionId}|${c.successCriteriaId}`)
          return {
            successCriteriaId: c.successCriteriaId,
            description: descriptionOf.get(c.successCriteriaId) ?? "",
            allocation: c.maxMarks,
            awarded: row ? Number(row.awarded) : null,
            available: row ? Number(row.available) : c.maxMarks,
            whyNotAwarded: row?.why_not_awarded ?? null,
            howToImprove: row?.how_to_improve ?? null,
            teacherFeedback: row?.teacher_feedback ?? null,
            provenance: row?.provenance ?? null,
            aiAwarded: row?.ai_awarded === null || row?.ai_awarded === undefined ? null : Number(row.ai_awarded),
          }
        }),
        evidenceSources: isPowerPoint ? q.evidence : [],
        evidenceImages: isPowerPoint ? questionEvidenceImages(q, powerPointRead!) : [],
        markerEvidence: powerPointRead?.markerEvidence.get(q.questionId) ?? null,
      }
    }),
  }
}

type PowerPointEvidenceRead = {
  files: Array<{
    fileId: string
    slotKey: string
    name: string
    storagePath: string
    uploadedAt: string
    evidence: SlotEvidence | null
  }>
  markerEvidence: Map<string, string>
}

/** A PowerPoint submission's files with what the reader made of each, and the marker's notes. */
async function readPowerPointEvidence(submissionId: string | null): Promise<PowerPointEvidenceRead> {
  if (!submissionId) return { files: [], markerEvidence: new Map() }
  const [{ rows: fileRows }, { rows: noteRows }] = await Promise.all([
    query<{
      file_id: string
      slot_key: string
      original_name: string
      storage_path: string
      uploaded_at: Date | string
      kind: EvidenceKind | null
      status: "ok" | "error" | null
      error: string | null
      cache_key: string | null
      report: unknown
      description: string | null
    }>(
      `select f.file_id::text as file_id, f.slot_key, f.original_name, f.storage_path, f.uploaded_at,
              e.kind, e.status, e.error, e.cache_key, e.report, null::text as description
         from practical_submission_files f
         left join practical_submission_evidence e on e.file_id = f.file_id
        where f.submission_id = $1
        order by f.slot_key`,
      [submissionId],
    ),
    query<{ question_id: string; marker_evidence: string }>(
      `select question_id, marker_evidence from submission_question_answers
        where submission_id = $1 and nullif(btrim(coalesce(marker_evidence, '')), '') is not null`,
      [submissionId],
    ),
  ])
  return {
    files: fileRows.map((row) => ({
      fileId: row.file_id,
      slotKey: row.slot_key,
      name: row.original_name,
      storagePath: row.storage_path,
      uploadedAt: new Date(row.uploaded_at).toISOString(),
      evidence:
        row.kind && row.status
          ? evidenceFromRow(row.kind, {
              status: row.status,
              error: row.error,
              cache_key: row.cache_key ?? "",
              report: row.report,
              description: row.description,
            })
          : null,
    })),
    markerEvidence: new Map(noteRows.map((row) => [row.question_id, row.marker_evidence.trim()])),
  }
}

function evidenceImage(image: Pick<StoredEvidenceImage, "path" | "width" | "height">, caption: string): AssessmentEvidenceImage {
  return { url: assessmentScriptUrl(image.path), caption, width: image.width, height: image.height }
}

function powerPointFiles(
  bodyData: unknown,
  handedIn: boolean,
  read: PowerPointEvidenceRead,
  questions: Array<{ label: string; evidence: QuestionEvidence[] }>,
): PowerPointResultFiles {
  const body = PowerPointAssessmentActivityBodySchema.safeParse(bodyData ?? {})
  const slots = body.success ? body.data.uploadSlots : []
  const fileOf = new Map(read.files.map((file) => [file.slotKey, file]))
  const labelOf = (slotKey: string) => slots.find((slot) => slot.key === slotKey)?.label ?? slotKey

  const warnings: string[] = []
  const missingHeadings: string[] = []
  const unplacedImages: AssessmentEvidenceImage[] = []
  for (const file of read.files) {
    const evidence = file.evidence
    if (!evidence || evidence.status !== "ok") continue
    for (const warning of evidenceWarnings(evidence)) warnings.push(`${labelOf(file.slotKey)}: ${warning}`)
    if (evidence.kind !== "evidence_doc") continue
    // Only the headings some question still reads from this slot.
    const headingsRead = new Set(
      questions.flatMap((q) =>
        q.evidence.flatMap((source) =>
          source.source === "evidence_section" && source.slot === file.slotKey
            ? [evidenceLabelKey(evidenceHeading(source, q.label))]
            : [],
        ),
      ),
    )
    missingHeadings.push(
      ...evidence.report.missingHeadings.filter((heading) => headingsRead.has(evidenceLabelKey(heading))),
    )
    evidence.report.unplaced.images.forEach((image, index) =>
      unplacedImages.push(evidenceImage(image, `${labelOf(file.slotKey)}: outside every heading, picture ${index + 1}`)),
    )
  }

  return {
    handedIn,
    files: slots.map((slot) => {
      const file = fileOf.get(slot.key)
      return {
        slotKey: slot.key,
        label: slot.label,
        kind: slot.kind,
        required: slot.required,
        name: file?.name ?? null,
        url: file ? assessmentScriptUrl(file.storagePath) : null,
        uploadedAt: file?.uploadedAt ?? null,
        evidenceStatus: file?.evidence?.status ?? null,
        evidenceError: file?.evidence?.status === "error" ? file.evidence.error : null,
      }
    }),
    missingHeadings,
    warnings,
    unplacedImages,
  }
}

/**
 * The pictures one question's sources give the marker, as the marker
 * assembles them (src/lib/powerpoint-assessment/marking.ts): each
 * screenshot under an evidence heading it reads for pictures, and each
 * slide drawn that it reads as slide_images.
 */
function questionEvidenceImages(
  question: { label: string; evidence: QuestionEvidence[] },
  read: PowerPointEvidenceRead,
): AssessmentEvidenceImage[] {
  const images: AssessmentEvidenceImage[] = []
  for (const source of question.evidence) {
    if (source.source !== "evidence_section" && source.source !== "slide_images") continue
    const evidence = read.files.find((file) => file.slotKey === source.slot)?.evidence
    if (!evidence || evidence.status !== "ok") continue
    if (source.source === "evidence_section" && source.want !== "text" && evidence.kind === "evidence_doc") {
      const heading = evidenceHeading(source, question.label)
      const section = evidence.report.sections.find((s) => evidenceLabelKey(s.label) === evidenceLabelKey(heading))
      section?.images.forEach((image, index) => images.push(evidenceImage(image, `${heading}, screenshot ${index + 1}`)))
    }
    if (source.source === "slide_images" && evidence.kind === "presentation" && evidence.slideImages?.status === "ok") {
      const wanted = source.slides ? new Set(source.slides) : null
      for (const image of evidence.slideImages.images) {
        if (!wanted || wanted.has(image.slide)) images.push(evidenceImage(image, `Slide ${image.slide}`))
      }
    }
  }
  return images
}

export type TeacherChangedQuestion = {
  label: string
  /** The question's mark with the teacher's changes taken out. */
  aiAwarded: number
  finalAwarded: number
  available: number
}

/** A pupil's marks before (AI) and after the teacher's changes. Teacher copy only. */
export type TeacherChangeSummary = {
  /** False when no criterion has an AI mark on record: legacy marks only, or teacher marks alone. */
  recorded: boolean
  /** Null when not recorded or not marked. */
  aiMarks: number | null
  finalMarks: number | null
  /** finalMarks - aiMarks; 0 when not recorded. */
  change: number
  /** Questions where a criterion's mark differs from the AI's, in paper order. */
  changedQuestions: TeacherChangedQuestion[]
  /** Questions with a teacher mark the AI never gave (or that is not known), counted the same in both totals. */
  teacherOnlyLabels: string[]
}

/**
 * The AI mark against the final mark, from criterion rows (teacher views only):
 *
 *   change   = Σ (awarded − ai_awarded) over criterion rows whose ai_awarded is known
 *   final    = the submission's marks (what every report shows)
 *   AI mark  = final − change: what the paper would score with no teacher change
 *
 * So an 'ai' row counts the same in both; a teacher row the AI never marked
 * (teacher-only question, teacher marked first, mark not recovered) counts its
 * teacher mark in both and is listed in teacherOnlyLabels; a legacy row (folded
 * from the old module) counts in both. With no ai_awarded anywhere there is
 * nothing to compare: not recorded, shown as "—".
 */
export function summariseTeacherChanges(
  result: Pick<AssessmentPaperResult, "marksAwarded" | "questions">,
): TeacherChangeSummary {
  let recorded = false
  let change = 0
  const changedQuestions: TeacherChangedQuestion[] = []
  const teacherOnlyLabels: string[] = []
  for (const question of result.questions) {
    let questionChange = 0
    let differs = false
    let teacherOnly = false
    for (const criterion of question.criteria) {
      if (criterion.awarded === null) continue
      if (criterion.aiAwarded === null) {
        if (criterion.provenance === "teacher") teacherOnly = true
        continue
      }
      recorded = true
      questionChange += criterion.awarded - criterion.aiAwarded
      if (criterion.awarded !== criterion.aiAwarded) differs = true
    }
    change += questionChange
    if (teacherOnly) teacherOnlyLabels.push(question.label)
    if (differs) {
      const finalAwarded = question.awarded ?? 0
      changedQuestions.push({
        label: question.label,
        aiAwarded: finalAwarded - questionChange,
        finalAwarded,
        available: question.available,
      })
    }
  }
  const finalMarks = result.marksAwarded
  if (!recorded || finalMarks === null) {
    return { recorded: false, aiMarks: null, finalMarks, change: 0, changedQuestions: [], teacherOnlyLabels: [] }
  }
  return { recorded, aiMarks: finalMarks - change, finalMarks, change, changedQuestions, teacherOnlyLabels }
}

export type PupilAssessmentPaperFeedback = {
  maxMarks: number
  /** Null until any question is marked. */
  marksAwarded: number | null
  /** The pupil's own script as uploaded, never the markable pages. Null on a folded paper with no script. */
  scriptUrl: string | null
  /** The feedback PDF, built when it is downloaded. */
  feedbackPdfUrl: string
  /** The teacher's overall comment, also printed in the PDF. */
  teacherComment: string | null
}

/** An assessment paper on the pupil's lesson page. */
export type PupilAssessmentPaperView = {
  /** The pupil has sat the paper (pupilHasSatAssessment). */
  sat: boolean
  /** Only once sat: before then the paper stays hidden. */
  questionPaperUrl: string | null
  /** Only once sat and the lesson's feedback is visible to the viewer. */
  feedback: PupilAssessmentPaperFeedback | null
}

/**
 * Whether the viewer may read this pupil's feedback: a teacher always; the
 * pupil only their own, once the lesson's feedback is visible to them, the
 * same source every other activity's feedback uses (readFeedbackVisibility).
 */
export async function pupilFeedbackVisible(activityId: string, pupilId: string): Promise<boolean> {
  const { rows } = await query<{ lesson_id: string }>("select lesson_id from activities where activity_id = $1", [
    activityId,
  ])
  if (!rows[0]) return false
  return (await readFeedbackVisibility(pupilId, rows[0].lesson_id)).visible_to_pupil
}

/**
 * What the pupil's lesson page shows: nothing but the title until they have
 * sat the paper; then the question paper; once feedback is visible, the
 * overall marks and links to the feedback PDF and their own script. The
 * per-question detail is only in the PDF. `viewerIsTeacher` skips the
 * visibility check (teachers preview).
 */
export async function readPupilAssessmentPaperView(
  activityId: string,
  pupilId: string,
  viewerIsTeacher: boolean,
): Promise<PupilAssessmentPaperView> {
  const { rows } = await query<{ type: string | null; max_marks: number | null; body_data: unknown }>(
    "select type, max_marks, body_data from activities where activity_id = $1",
    [activityId],
  )
  const activity = rows[0]
  if (!activity) throw new Error("Activity not found.")
  if (!isAssessmentPaperType(activity.type)) throw new Error("This activity is not an assessment paper.")
  if (!(await pupilHasSatAssessment(activityId, pupilId))) return { sat: false, questionPaperUrl: null, feedback: null }

  const body = AssessmentPaperActivityBodySchema.safeParse(activity.body_data ?? {})
  const questionPaperPath = body.success ? body.data.questionPaperPath ?? null : null
  const questionPaperUrl = questionPaperPath ? assessmentScriptUrl(questionPaperPath) : null
  if (!viewerIsTeacher && !(await pupilFeedbackVisible(activityId, pupilId))) {
    return { sat: true, questionPaperUrl, feedback: null }
  }

  const { rows: latest } = await query<{ marks: number | null; original_path: string | null }>(
    `select (s.body::jsonb ->> 'marks')::int as marks,
            (select sc.original_path from assessment_scripts sc
              where sc.activity_id = s.activity_id and sc.pupil_id = s.user_id and sc.submission_id = s.submission_id
              order by sc.uploaded_at desc, sc.script_id desc limit 1) as original_path
       from submissions s
      where s.activity_id = $1 and s.user_id = $2
      order by s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
      limit 1`,
    [activityId, pupilId],
  )
  const submission = latest[0]
  return {
    sat: true,
    questionPaperUrl,
    feedback: submission
      ? {
          maxMarks: Number(activity.max_marks) || 0,
          marksAwarded: submission.marks === null ? null : Number(submission.marks),
          scriptUrl: submission.original_path ? assessmentScriptUrl(submission.original_path) : null,
          feedbackPdfUrl: assessmentFeedbackPdfUrl(activityId, pupilId),
          teacherComment: await readOverallTeacherFeedback(activityId, pupilId),
        }
      : null,
  }
}

/** The teacher's latest overall comment on the activity, if any. */
export async function readOverallTeacherFeedback(activityId: string, pupilId: string): Promise<string | null> {
  const { data } = await fetchPupilActivityFeedbackMap({ activityIds: [activityId], pupilIds: [pupilId] })
  return selectLatestFeedbackEntry(data?.get(`${pupilId}::${activityId}`), "teacher")?.feedback_text?.trim() || null
}
