import "server-only"

import sharp from "sharp"

import { query } from "@/lib/db"
import { pupilHasSatAssessment, readMarkablePages } from "@/lib/assessment-paper/files"
import {
  pupilFeedbackVisible,
  readAssessmentPaperResult,
  readOverallTeacherFeedback,
} from "@/lib/assessment-paper/results"
import { effectiveQuestionCriterionFeedback, type AnswerKind, type AnswerStatus } from "@/lib/assessment-paper/store"
import { readFeedbackVisibility } from "@/lib/mcp/pupil-feedback"
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

export type FeedbackPdfData = {
  paperTitle: string
  pupilName: string
  className: string | null
  maxMarks: number
  marksAwarded: number | null
  overallFeedback: string | null
  /** Folded in from the old assessments module: marks and feedback only. */
  folded: boolean
  questions: FeedbackPdfQuestion[]
}

/**
 * Who may download a pupil's feedback PDF: a teacher, for any pupil; the
 * pupil, for their own, once they have sat the paper and the lesson's
 * feedback is visible to them: the same rule as opening their own script.
 */
export async function mayDownloadAssessmentFeedback(
  viewer: { userId: string; isTeacher: boolean },
  activityId: string,
  pupilId: string,
): Promise<boolean> {
  if (viewer.isTeacher) return true
  if (viewer.userId !== pupilId) return false
  if (!(await pupilHasSatAssessment(activityId, pupilId))) return false
  return pupilFeedbackVisible(activityId, pupilId)
}

function needsImages(kind: AnswerKind, status: AnswerStatus) {
  return status === "unreadable" || kind === "sketch" || kind === "mixed"
}

export async function readAssessmentFeedbackPdfData(activityId: string, pupilId: string): Promise<FeedbackPdfData> {
  const result = await readAssessmentPaperResult(activityId, pupilId)

  const [{ rows: activityRows }, { rows: profileRows }, visibility, overallFeedback] = await Promise.all([
    query<{ title: string | null; body_data: unknown }>("select title, body_data from activities where activity_id = $1", [
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

  // Only the pages an answer needs, loaded once for the whole paper.
  const wanted = new Set<number>()
  if (!folded) {
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

  return {
    paperTitle: activityRows[0]?.title?.trim() || "Assessment paper",
    pupilName: [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Pupil",
    className: classNames.length > 0 ? classNames.join(", ") : null,
    maxMarks: result.maxMarks,
    marksAwarded: result.marksAwarded,
    overallFeedback,
    folded,
    questions: result.questions.map((q) => {
      const isLegacy = q.criteria.length > 0 && q.criteria.every((c) => c.provenance === "legacy")
      const answer = !folded && q.answer
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
        awarded: q.awarded,
        answer,
        // A legacy mark is the question's, repeated on every criterion with
        // the same comment, so it is shown once.
        legacy: isLegacy ? { feedback: effectiveQuestionCriterionFeedback(q.criteria[0]) } : null,
        criteria: q.criteria.map((c) => ({
          description: c.description,
          awarded: c.awarded,
          available: c.allocation,
          feedback: effectiveQuestionCriterionFeedback(c),
        })),
        markScheme: showMarkScheme ? q.markScheme : null,
      }
    }),
  }
}
