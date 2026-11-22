import "server-only"

import { query } from "@/lib/db"
import { isAssessmentPaperType, isDatabaseAssessmentType, isPowerPointAssessmentType } from "@/dino.config"
import { MODEL_CATALOGUE, findOwnModelRoute, resolveModelRoute, type ModelChoice } from "@/lib/ai/model-routing"
import { questionModelProblem, questionSendsImages } from "@/lib/assessment-paper/question-model"

/**
 * Surface key in ai_model_routes (migration 149) of the model that marks an
 * assessment paper answer the reader read as text (kind 'text', status
 * 'answered'), still with its page images.
 */
export const ASSESSMENT_TEXT_ANSWER_SURFACE = "surface:assessment-mark-text"

/**
 * Surface keys of the model that marks a practical question whose evidence
 * sends no pictures (questionSendsImages false). PowerPoint's is seeded
 * (migration 150); the database one has no row until an admin adds it.
 */
export const POWERPOINT_TEXT_QUESTION_SURFACE = "surface:powerpoint-mark-text"
export const DATABASE_TEXT_QUESTION_SURFACE = "surface:database-mark-text"

/** The text route surface of a question-marked type: the paper's text-answer key, a practical type's text-question key, else null. */
export function textRouteSurface(type: string | null | undefined): string | null {
  if (isAssessmentPaperType(type)) return ASSESSMENT_TEXT_ANSWER_SURFACE
  if (isPowerPointAssessmentType(type)) return POWERPOINT_TEXT_QUESTION_SURFACE
  if (isDatabaseAssessmentType(type)) return DATABASE_TEXT_QUESTION_SURFACE
  return null
}

export interface QuestionModelRoute extends ModelChoice {
  /**
   * 'question' when the question's own marking_model is used; 'text-answers'
   * when the paper's text-answer route is (a text answer, no question model);
   * 'text-questions' when a practical type's text-question route is (no
   * pictures sent, no question model); else 'activity'.
   */
  source: "question" | "text-answers" | "text-questions" | "activity"
  /** A stored marking_model that was not used, and why; null when none was ignored. */
  ignored: { model: string; reason: string } | null
  /** A text route that was due but not used, its surface, and why; null when none was skipped. */
  textRouteIgnored: { surface: string; model: string; reason: string } | null
}

/**
 * Why a text-answer route cannot be used, or null. It must be a catalogue
 * text model that is available. No image rule: it is the cheaper model for
 * answers the reader already read as text.
 */
export function textAnswerRouteProblem(route: ModelChoice, surface: string = ASSESSMENT_TEXT_ANSWER_SURFACE): string | null {
  const entry = MODEL_CATALOGUE.find((e) => e.provider === route.provider && e.model === route.model)
  if (!entry || entry.kind !== "text") return `${surface} names ${route.provider}/${route.model}, which is not a text model in the catalogue.`
  if (!entry.available) return `${surface} names ${entry.label}, which cannot be used for marking.`
  return null
}

/** True when the reader recorded this answer as text it could read (the text-answer route applies). */
export function isTextAnswer(answer: { kind: string | null; status: string | null } | null | undefined): boolean {
  return answer?.kind === "text" && answer?.status === "answered"
}

/**
 * The model that marks one question, most specific first:
 *   1. its marking_model (migration 148) when that is still allowed (in the
 *      catalogue, available, and high-resolution vision when the question
 *      sends pictures);
 *   2. `textRoute` when given and usable (textAnswerRouteProblem): the caller
 *      passes the type's text route (textRouteSurface) only when that surface
 *      has its own active row. On an assessment paper the caller also passes
 *      it only for a text answer; on a practical type it applies only when
 *      the question sends no pictures (questionSendsImages);
 *   3. the activity's route, as before the column existed.
 */
export function chooseQuestionModel(
  type: string | null | undefined,
  question: { label: string; markingModel: string | null; evidence: readonly unknown[] | null },
  activityRoute: ModelChoice,
  textRoute: ModelChoice | null = null,
): QuestionModelRoute {
  let ignored: QuestionModelRoute["ignored"] = null
  if (question.markingModel) {
    const problem = questionModelProblem({
      label: question.label,
      type,
      evidence: question.evidence,
      model: question.markingModel,
      catalogue: MODEL_CATALOGUE,
    })
    if (!problem) {
      const entry = MODEL_CATALOGUE.find((e) => e.model === question.markingModel)!
      return { provider: entry.provider, model: entry.model, effort: entry.effort, source: "question", ignored: null, textRouteIgnored: null }
    }
    ignored = { model: question.markingModel, reason: problem }
  }
  const surface = textRouteSurface(type)
  const textRouteDue = isAssessmentPaperType(type) || !questionSendsImages(type, question.evidence)
  if (textRoute && surface && textRouteDue) {
    const problem = textAnswerRouteProblem(textRoute, surface)
    const source = isAssessmentPaperType(type) ? "text-answers" : "text-questions"
    if (!problem) return { ...textRoute, source, ignored, textRouteIgnored: null }
    return { ...activityRoute, source: "activity", ignored, textRouteIgnored: { surface, model: textRoute.model, reason: problem } }
  }
  return { ...activityRoute, source: "activity", ignored, textRouteIgnored: null }
}

/**
 * The text route chooseQuestionModel should be given for a practical question
 * as stored: the type's text-question surface's own active row when the
 * question sends no pictures, else null. Never used on a paper (whose text
 * route depends on the pupil's answer).
 */
export async function practicalTextRouteFor(
  type: string | null | undefined,
  evidence: readonly unknown[] | null | undefined,
): Promise<ModelChoice | null> {
  if (isAssessmentPaperType(type)) return null
  const surface = textRouteSurface(type)
  if (!surface || questionSendsImages(type, evidence)) return null
  return findOwnModelRoute(surface)
}

/**
 * chooseQuestionModel for a stored question, read by id. On an assessment
 * paper, `submissionId` names whose answer decides the text-answer route
 * (this question's own answer only, never a depends_on one). On a practical
 * type the question's evidence decides (practicalTextRouteFor).
 */
export async function resolveQuestionModelRoute(
  type: string | null | undefined,
  questionId: string,
  submissionId?: string,
): Promise<QuestionModelRoute> {
  const activityRoute = await resolveModelRoute(type, null)
  const { rows } = await query<{ label: string; marking_model: string | null; evidence: unknown[] | null }>(
    "select label, marking_model, evidence from activity_questions where question_id::text = $1",
    [questionId],
  )
  if (!rows[0]) return { ...activityRoute, source: "activity", ignored: null, textRouteIgnored: null }
  let textRoute: ModelChoice | null = null
  if (!isAssessmentPaperType(type)) {
    textRoute = await practicalTextRouteFor(type, rows[0].evidence)
  } else if (submissionId) {
    const { rows: answers } = await query<{ kind: string | null; status: string | null }>(
      "select kind, status from submission_question_answers where submission_id::text = $1 and question_id::text = $2",
      [submissionId, questionId],
    )
    if (isTextAnswer(answers[0])) textRoute = await findOwnModelRoute(ASSESSMENT_TEXT_ANSWER_SURFACE)
  }
  return chooseQuestionModel(
    type,
    { label: rows[0].label, markingModel: rows[0].marking_model, evidence: rows[0].evidence },
    activityRoute,
    textRoute,
  )
}
