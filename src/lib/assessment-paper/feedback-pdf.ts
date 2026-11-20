import "server-only"

import sharp from "sharp"

import { query } from "@/lib/db"
import { isPracticalAssessmentType } from "@/dino.config"
import { pupilHasSatAssessment, readMarkablePages, readQuestionPaperPdf } from "@/lib/assessment-paper/files"
import {
  pupilFeedbackVisible,
  readAssessmentPaperResult,
  readOverallTeacherFeedback,
  questionOutcome,
  summariseTeacherChanges,
  type QuestionOutcome,
  type TeacherChangeSummary,
} from "@/lib/assessment-paper/results"
import {
  effectiveQuestionCriterionFeedback,
  type AnswerKind,
  type AnswerStatus,
  type SubmissionQuestionAnswer,
} from "@/lib/assessment-paper/store"
import { isLessonLockedForUser } from "@/lib/lesson-lock"
import { powerPointMarkState, powerPointQuestionShownToPupil } from "@/lib/assessment-paper/pupil-feedback"
import { readFeedbackVisibility } from "@/lib/mcp/pupil-feedback"
import { pdfText } from "@/lib/pdf/poppler"
import { practicalTypeConfig } from "@/lib/practical-assessment/types"
import { AssessmentPaperActivityBodySchema } from "@/types"

// What a pupil's feedback PDF on an assessment paper holds, read fresh when it
// is downloaded so a teacher's change is always in it. The pupil's answer
// images come from the markable pages (readMarkablePages), never the original
// script or page 1, and only for the answers a transcription cannot carry: a
// sketch, a mix of words and drawing, or one the reader could not read.

const IMAGE_WIDTH = 1100

export type FeedbackPdfCriterion = {
  description: string
  awarded: number | null
  available: number
  feedback: ReturnType<typeof effectiveQuestionCriterionFeedback>
}

export type FeedbackPdfQuestion = {
  label: string
  questionText: string | null
  maxMarks: number
  awarded: number | null
  /** Null on a folded paper (no answers) or a script not read yet. */
  answer: {
    kind: AnswerKind
    status: AnswerStatus
    transcription: string | null
    /** JPEG data URIs of the markable pages the answer is on. */
    images: Array<{ pageNumber: number; src: string }>
  } | null
  criteria: FeedbackPdfCriterion[]
  /** A paper folded in from the old module: one mark and comment for the whole question. */
  legacy: { feedback: ReturnType<typeof effectiveQuestionCriterionFeedback> } | null
  /** Null when the paper's setting hides it or the question has none. */
  markScheme: string | null
}

/**
 * A practical assessment's questions as its question paper sets them out: a
 * task per leading part of the label (1a, 1b → task 1; S1..S5 → Section B),
 * in position order, with the marks the pupil was shown out of the task's.
 */
export type FeedbackPdfTask = {
  heading: string
  /** Shown marks only; a question with no mark counts 0. */
  awarded: number
  available: number
  /** `part` is "(a)" for 1a, or the label itself when it has no part letter (S1). */
  parts: Array<{ part: string; question: FeedbackPdfQuestion }>
}

/** Task titles found in the question paper's text; empty when there is none. */
export type TaskTitles = { tasks: Record<string, string>; sectionB: string | null }

const NO_TASK_TITLES: TaskTitles = { tasks: {}, sectionB: null }
const QUESTION_PAPER_TEXT_CHARS = 200_000
const MAX_TITLE_CHARS = 100

export type FeedbackPdfData = {
  paperTitle: string
  pupilName: string
  className: string | null
  maxMarks: number
  marksAwarded: number | null
  overallFeedback: string | null
  /** Folded in from the old assessments module: marks and feedback only. */
  folded: boolean
  /** A practical assessment (PowerPoint or database): the pupil's work is their files, not a script. */
  powerPoint: boolean
  questions: FeedbackPdfQuestion[]
  /** A practical assessment's questions grouped as tasks; null on an assessment paper. */
  tasks: FeedbackPdfTask[] | null
  /**
   * The AI's marks against the teacher's (summariseTeacherChanges). Only in
   * the teacher copy (the class PDF); never set on a pupil's own PDF.
   */
  teacherChanges?: TeacherChangeSummary
  /** Each question's outcome (questionOutcome), for the class PDF's question analysis. Teacher copy only. */
  questionOutcomes?: Array<{ questionId: string; outcome: QuestionOutcome; awarded: number | null }>
}

/**
 * Who may download a pupil's feedback PDF: a teacher, for any pupil; the
 * pupil, for their own, once they have sat the paper (a PowerPoint
 * assessment: handed in their work, not still waiting to be marked, when
 * held only once a teacher has marked a question, and the lesson is not
 * locked for them, as for their other downloads: the rule their lesson page
 * follows) and the lesson's feedback is visible to them: the same rule as
 * opening their own script.
 */
export async function mayDownloadAssessmentFeedback(
  viewer: { userId: string; isTeacher: boolean },
  activityId: string,
  pupilId: string,
): Promise<boolean> {
  if (viewer.isTeacher) return true
  if (viewer.userId !== pupilId) return false
  const { rows } = await query<{ type: string | null; lesson_id: string }>(
    "select type, lesson_id from activities where activity_id = $1",
    [activityId],
  )
  if (!rows[0]) return false
  if (isPracticalAssessmentType(rows[0].type)) {
    if (!(await powerPointFeedbackReady(activityId, pupilId))) return false
    if (await isLessonLockedForUser(pupilId, rows[0].lesson_id)) return false
  } else if (!(await pupilHasSatAssessment(activityId, pupilId))) {
    return false
  }
  return pupilFeedbackVisible(activityId, pupilId)
}

/**
 * Whether a pupil's PowerPoint work has feedback to show them, as their
 * lesson page decides (pupil-view.ts): handed in, not waiting to be marked,
 * and when held, at least one question a teacher has marked.
 */
async function powerPointFeedbackReady(activityId: string, pupilId: string): Promise<boolean> {
  const result = await readAssessmentPaperResult(activityId, pupilId)
  const markState = powerPointMarkState(Boolean(result.powerpoint?.handedIn), result.markStatus)
  if (markState === "not-handed-in" || markState === "waiting") return false
  return result.questions.some((question) => powerPointQuestionShownToPupil(markState, question))
}

function needsImages(kind: AnswerKind, status: AnswerStatus) {
  return status === "unreadable" || kind === "sketch" || kind === "mixed"
}

/**
 * Task titles from a question paper's text (pdftotext -layout): "Task 1 –
 * Master slide (10 marks)" gives task 1 "Master slide"; the dash may be –, —
 * or -, and the marks are optional. "Section B – Short answer (8 marks)" gives
 * "Section B – Short answer". The first line for each wins. Text in a second
 * layout column (after three or more spaces) is ignored.
 */
export function parseTaskTitles(text: string): TaskTitles {
  const tasks: Record<string, string> = {}
  let sectionB: string | null = null
  for (const line of text.split(/\r?\n|\f/)) {
    const segment = line.trim().split(/\s{3,}/)[0]
    const task = segment.match(/^Task\s+(\d+)\s*[–—-]\s*(.+)$/i)
    if (task) {
      const title = task[2].replace(/\s*\(\s*\d+\s*marks?\s*\)\s*$/i, "").trim().slice(0, MAX_TITLE_CHARS)
      const number = String(Number(task[1]))
      if (title && !(number in tasks)) tasks[number] = title
      continue
    }
    const section = segment.match(/^Section\s+B\s*[–—-]\s*(.+)$/i)
    if (section && sectionB === null) {
      const title = section[1].split("(")[0].trim().slice(0, MAX_TITLE_CHARS)
      if (title) sectionB = `Section B – ${title}`
    }
  }
  return { tasks, sectionB }
}

/**
 * The task titles in the activity's question paper. Never throws: no paper,
 * or one pdftotext cannot read, gives no titles and the headings fall back to
 * "Task N".
 */
export async function readTaskTitles(activityId: string): Promise<TaskTitles> {
  try {
    const pdf = await readQuestionPaperPdf(activityId)
    if (!pdf) return NO_TASK_TITLES
    return parseTaskTitles((await pdfText(pdf, { maxChars: QUESTION_PAPER_TEXT_CHARS })).text)
  } catch (error) {
    console.error("[assessment-paper] feedback PDF could not read the question paper's task titles", error)
    return NO_TASK_TITLES
  }
}

/** A label's task (its leading number or letters) and part: 1a → 1, "(a)"; S1 → S, "S1". */
export function questionTaskPart(label: string): { group: string; part: string } {
  const trimmed = label.trim()
  const lettered = trimmed.match(/^(\d+)\s*\(?([a-z]+)\)?$/i)
  if (lettered) return { group: String(Number(lettered[1])), part: `(${lettered[2].toLowerCase()})` }
  const lead = trimmed.match(/^(\d+|[a-z]+)/i)?.[1]
  if (!lead) return { group: trimmed, part: trimmed }
  return { group: /^\d+$/.test(lead) ? String(Number(lead)) : lead.toUpperCase(), part: trimmed }
}

function taskHeading(group: string, titles: TaskTitles): string {
  if (/^\d+$/.test(group)) return titles.tasks[group] ? `Task ${group} – ${titles.tasks[group]}` : `Task ${group}`
  if (group === "S") return titles.sectionB ?? "Section B"
  return group
}

/** Questions in position order, a task per run of the same group. */
export function groupFeedbackTasks(questions: FeedbackPdfQuestion[], titles: TaskTitles): FeedbackPdfTask[] {
  const tasks: FeedbackPdfTask[] = []
  let lastGroup: string | null = null
  for (const question of questions) {
    const { group, part } = questionTaskPart(question.label)
    if (group !== lastGroup) {
      tasks.push({ heading: taskHeading(group, titles), awarded: 0, available: 0, parts: [] })
      lastGroup = group
    }
    const task = tasks[tasks.length - 1]
    task.awarded += question.awarded ?? 0
    task.available += question.maxMarks
    task.parts.push({ part, question })
  }
  return tasks
}

/**
 * `teacherCopy` adds the AI-against-teacher marks; only the class PDF passes
 * it. `taskTitles` saves the class PDF reading the question paper per pupil.
 */
export async function readAssessmentFeedbackPdfData(
  activityId: string,
  pupilId: string,
  options: { teacherCopy?: boolean; taskTitles?: TaskTitles } = {},
): Promise<FeedbackPdfData> {
  const result = await readAssessmentPaperResult(activityId, pupilId)

  const [{ rows: activityRows }, { rows: profileRows }, visibility, overallFeedback] = await Promise.all([
    query<{ title: string | null; type: string | null; body_data: unknown }>("select title, type, body_data from activities where activity_id = $1", [
      activityId,
    ]),
    query<{ first_name: string | null; last_name: string | null }>(
      "select first_name, last_name from profiles where user_id = $1",
      [pupilId],
    ),
    readFeedbackVisibility(pupilId, result.lessonId),
    readOverallTeacherFeedback(activityId, pupilId),
  ])
  const rawBody = (activityRows[0]?.body_data ?? {}) as Record<string, unknown>
  const body = AssessmentPaperActivityBodySchema.safeParse(rawBody)
  const showMarkScheme = !body.success || body.data.showMarkSchemeToPupils !== false
  const folded = Array.isArray(rawBody.foldedFromAssessmentIds)
  const powerPoint = result.powerpoint !== null
  // The pupil's copy of PowerPoint work not yet marked shows only what a
  // teacher has marked, as their lesson page does; the teacher copy shows all.
  const markState = powerPoint ? powerPointMarkState(Boolean(result.powerpoint?.handedIn), result.markStatus) : null
  const shown = (question: { provenance: string | null }) =>
    !markState || options.teacherCopy || powerPointQuestionShownToPupil(markState, question)
  const allShown = result.questions.every(shown)

  // Only the pages an answer needs, loaded once for the whole paper.
  const wanted = new Set<number>()
  if (!folded && !powerPoint) {
    for (const q of result.questions) {
      if (q.answer && needsImages(q.answer.kind, q.answer.status)) q.answer.pages.forEach((p) => wanted.add(p))
    }
  }
  const images = new Map<number, string>()
  if (wanted.size > 0 && result.script) {
    const pages = await readMarkablePages(result.script.scriptId).catch((error) => {
      console.error("[assessment-paper] feedback PDF could not load the markable pages", error)
      return []
    })
    for (const page of pages) {
      if (!wanted.has(page.pageNumber)) continue
      const jpeg = await sharp(page.bytes)
        .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 80 })
        .toBuffer()
      images.set(page.pageNumber, `data:image/jpeg;base64,${jpeg.toString("base64")}`)
    }
  }

  const profile = profileRows[0]
  const classNames = Array.from(
    new Set(visibility.assignments.map((a) => a.group_id).filter((id): id is string => Boolean(id))),
  )

  const questions: FeedbackPdfQuestion[] = result.questions.map((q) => {
    const marksShown = shown(q)
    const isLegacy = q.criteria.length > 0 && q.criteria.every((c) => c.provenance === "legacy")
    const answer = powerPoint
      ? powerPointAnswer(q.answer)
      : !folded && q.answer
      ? {
          kind: q.answer.kind,
          status: q.answer.status,
          transcription: q.answer.transcription,
          images: needsImages(q.answer.kind, q.answer.status)
            ? q.answer.pages.flatMap((p) => {
                const src = images.get(p)
                return src ? [{ pageNumber: p, src }] : []
              })
            : [],
        }
      : null
    return {
      label: q.label,
      questionText: q.questionText,
      maxMarks: q.available,
      awarded: marksShown ? q.awarded : null,
      answer,
      // A legacy mark is the question's, repeated on every criterion with
      // the same comment, so it is shown once.
      legacy: isLegacy && marksShown ? { feedback: effectiveQuestionCriterionFeedback(q.criteria[0]) } : null,
      criteria: q.criteria.map((c) => ({
        description: c.description,
        awarded: marksShown ? c.awarded : null,
        available: c.allocation,
        feedback: marksShown ? effectiveQuestionCriterionFeedback(c) : null,
      })),
      markScheme: showMarkScheme ? q.markScheme : null,
    }
  })
  const taskTitles = powerPoint ? options.taskTitles ?? (await readTaskTitles(activityId)) : null

  return {
    paperTitle: activityRows[0]?.title?.trim() || (powerPoint ? practicalTypeConfig(activityRows[0]?.type).label : "Assessment paper"),
    pupilName: [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Pupil",
    className: classNames.length > 0 ? classNames.join(", ") : null,
    maxMarks: result.maxMarks,
    marksAwarded: allShown
      ? result.marksAwarded
      : result.questions.filter(shown).reduce((sum, q) => sum + (q.awarded ?? 0), 0),
    overallFeedback,
    folded,
    powerPoint,
    ...(options.teacherCopy
      ? {
          teacherChanges: summariseTeacherChanges(result),
          questionOutcomes: result.questions.map((q) => ({ questionId: q.questionId, outcome: questionOutcome(q), awarded: q.awarded })),
        }
      : {}),
    questions,
    tasks: taskTitles ? groupFeedbackTasks(questions, taskTitles) : null,
  }
}

/**
 * A PowerPoint task's answer as its PDF shows it: blank, or the typed answer
 * of a task that reads only typed text. Anything else (the reader's digest
 * of the files) is not the pupil's answer and is left out.
 */
function powerPointAnswer(answer: SubmissionQuestionAnswer | null): FeedbackPdfQuestion["answer"] {
  if (!answer) return null
  if (answer.status === "blank") return { kind: answer.kind, status: "blank", transcription: null, images: [] }
  if (answer.kind !== "text" || !answer.transcription?.trim()) return null
  return { kind: "text", status: answer.status, transcription: answer.transcription, images: [] }
}
