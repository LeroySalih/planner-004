import "server-only"

import { query } from "@/lib/db"
import { isAssessmentPaperType, isPracticalAssessmentType, isQuestionMarkedActivityType } from "@/dino.config"
import { pupilHasSatAssessment } from "@/lib/assessment-paper/files"
import { pupilQuestionFlag, readQuestionFlags } from "@/lib/assessment-paper/question-flags"
import {
  assessmentScriptUrl,
  pupilFeedbackVisible,
  readAssessmentPaperResult,
  readOverallTeacherFeedback,
  type AssessmentPaperResult,
} from "@/lib/assessment-paper/results"
import { effectiveQuestionCriterionFeedback } from "@/lib/assessment-paper/store"
import { assessmentFeedbackPdfUrl } from "@/lib/assessment-paper/urls"
import { LESSON_LOCKED_MESSAGE, isActivityLockedForUser } from "@/lib/lesson-lock"
import { AssessmentPaperActivityBodySchema } from "@/types"

// What a pupil's lesson page shows of a question-marked activity's marks, the
// same for an assessment paper and a PowerPoint assessment (one component,
// AssessmentQuestionFeedback, draws both): the total, the teacher's comment,
// the feedback PDF and, question by question, the mark, the comments and the
// pupil's flag. Which questions show their marks is the type's own rule.
//
// Built on the server for the pupil, so it carries only what is theirs to
// see: never the AI's own mark beside a teacher's, the marker's evidence
// note, the mark scheme, the reader's transcription, the submission's
// mark_error or who dealt with a flag.

export type PupilAssessmentCriterionComment =
  | { source: "teacher"; text: string }
  | { source: "ai"; whyNotAwarded: string | null; howToImprove: string | null }

export type PupilAssessmentQuestionFeedback = {
  questionId: string
  label: string
  questionText: string | null
  /** Null when this question has no mark the pupil can see yet. */
  awarded: number | null
  available: number
  /** One per criterion that has something to say, in criterion order. */
  comments: PupilAssessmentCriterionComment[]
  /**
   * The pupil's flag on this question (migration 144): one is open, or the
   * latest was checked by a teacher and whether the mark changed. Never who.
   */
  flag: { open: boolean; lastOutcome: "changed" | "unchanged" | null }
}

export type PupilAssessmentFeedback = {
  /** The latest attempt, which the pupil flags questions on. */
  submissionId: string | null
  maxMarks: number
  /** Null until any question the pupil can see is marked. */
  marksAwarded: number | null
  /** The teacher's overall comment on the activity. */
  teacherComment: string | null
  /** The feedback PDF, built when it is downloaded; null while downloads are blocked (locked lesson). */
  feedbackPdfUrl: string | null
  questions: PupilAssessmentQuestionFeedback[]
}

/** Which of a question's marks a pupil may see. */
type QuestionShown = (question: { awarded: number | null; provenance: string | null }) => boolean

export type PupilPowerPointMarkState =
  /** Not handed in yet (files may be uploaded). */
  | "not-handed-in"
  /** Handed in, marking queued or under way. */
  | "waiting"
  /** Every question marked. */
  | "marked"
  /** Handed in but stopped: a file could not be read, or the teacher has something to look at. */
  | "held"

const IN_FLIGHT = new Set(["waiting", "marking", "queued", "pending"])

/** Where a pupil's PowerPoint work has got to, as they see it (and as their feedback PDF follows). */
export function powerPointMarkState(handedIn: boolean, markStatus: string | null): PupilPowerPointMarkState {
  if (!handedIn) return "not-handed-in"
  if (markStatus === "marked") return "marked"
  if (markStatus && IN_FLIGHT.has(markStatus)) return "waiting"
  // null after hand-in (held with a reason), 'marking-error', 'reading-error'.
  return "held"
}

/**
 * Whether a pupil sees a PowerPoint question's marks: all of them once the
 * work is marked; on held work only a question with a teacher's mark on it
 * (question provenance 'teacher'), never the marker's marks or 0s on the rest.
 */
export function powerPointQuestionShownToPupil(
  markState: PupilPowerPointMarkState,
  question: { provenance: string | null },
): boolean {
  return markState === "marked" || question.provenance === "teacher"
}

/**
 * Whether a pupil sees an assessment paper question's marks: once the paper
 * is marked; before that (being read or marked, or held) only a question a
 * teacher has marked, or one carried over from an old paper (legacy).
 */
export function assessmentPaperQuestionShownToPupil(
  markStatus: string | null,
  question: { awarded: number | null; provenance: string | null },
): boolean {
  if (question.awarded === null) return false
  return markStatus === "marked" || question.provenance === "teacher" || question.provenance === "legacy"
}

/** The pupil's feedback on `result`, showing only the questions `shown` allows. */
export async function buildPupilAssessmentFeedback(
  result: AssessmentPaperResult,
  options: { shown: QuestionShown; feedbackPdfUrl: string | null },
): Promise<PupilAssessmentFeedback> {
  const { shown } = options
  const visible = result.questions.filter(shown)
  const marksAwarded =
    visible.length === result.questions.length
      ? result.marksAwarded
      : visible.length === 0
        ? null
        : visible.reduce((sum, question) => sum + (question.awarded ?? 0), 0)
  const [teacherComment, flags] = await Promise.all([
    readOverallTeacherFeedback(result.activityId, result.pupilId),
    readQuestionFlags(result.submissionId),
  ])

  return {
    submissionId: result.submissionId,
    maxMarks: result.maxMarks,
    marksAwarded,
    teacherComment,
    feedbackPdfUrl: options.feedbackPdfUrl,
    questions: result.questions.map((question) => ({
      questionId: question.questionId,
      label: question.label,
      questionText: question.questionText,
      awarded: shown(question) ? question.awarded : null,
      available: question.available,
      comments: !shown(question) ? [] : question.criteria.flatMap((criterion): PupilAssessmentCriterionComment[] => {
        const comment = effectiveQuestionCriterionFeedback(criterion)
        if (!comment) return []
        // Only the fields a pupil reads, whatever the helper returns.
        return comment.source === "teacher"
          ? [{ source: "teacher", text: comment.text }]
          : [{ source: "ai", whyNotAwarded: comment.whyNotAwarded, howToImprove: comment.howToImprove }]
      }),
      flag: pupilQuestionFlag(flags.get(question.questionId)),
    })),
  }
}

/** An assessment paper on the pupil's lesson page. */
export type PupilAssessmentPaperView = {
  /** The pupil has sat the paper (pupilHasSatAssessment). */
  sat: boolean
  /** Only once sat: before then the paper stays hidden. */
  questionPaperUrl: string | null
  /** The pupil's own script as uploaded, never the markable pages; only with the feedback. */
  scriptUrl: string | null
  /** Only once sat and the lesson's feedback is visible to the viewer. */
  feedback: PupilAssessmentFeedback | null
}

/**
 * What the pupil's lesson page shows of an assessment paper: nothing but the
 * title until they have sat it; then the question paper; once feedback is
 * visible, their marks question by question, the feedback PDF and their own
 * script. `viewerIsTeacher` skips the visibility check (teachers preview).
 */
export async function readPupilAssessmentPaperView(
  activityId: string,
  pupilId: string,
  viewerIsTeacher: boolean,
): Promise<PupilAssessmentPaperView> {
  const { rows } = await query<{ type: string | null; body_data: unknown }>(
    "select type, body_data from activities where activity_id = $1",
    [activityId],
  )
  const activity = rows[0]
  if (!activity) throw new Error("Activity not found.")
  if (!isAssessmentPaperType(activity.type)) throw new Error("This activity is not an assessment paper.")
  const hidden = { sat: false, questionPaperUrl: null, scriptUrl: null, feedback: null }
  if (!(await pupilHasSatAssessment(activityId, pupilId))) return hidden

  const body = AssessmentPaperActivityBodySchema.safeParse(activity.body_data ?? {})
  const questionPaperPath = body.success ? body.data.questionPaperPath ?? null : null
  const questionPaperUrl = questionPaperPath ? assessmentScriptUrl(questionPaperPath) : null
  if (!viewerIsTeacher && !(await pupilFeedbackVisible(activityId, pupilId))) {
    return { ...hidden, sat: true, questionPaperUrl }
  }

  const result = await readAssessmentPaperResult(activityId, pupilId)
  if (!result.submissionId) return { ...hidden, sat: true, questionPaperUrl }
  const { rows: scripts } = await query<{ original_path: string }>(
    `select original_path from assessment_scripts
      where activity_id = $1 and pupil_id = $2 and submission_id = $3
      order by uploaded_at desc, script_id desc limit 1`,
    [activityId, pupilId, result.submissionId],
  )
  return {
    sat: true,
    questionPaperUrl,
    scriptUrl: scripts[0] ? assessmentScriptUrl(scripts[0].original_path) : null,
    feedback: await buildPupilAssessmentFeedback(result, {
      shown: (question) => assessmentPaperQuestionShownToPupil(result.markStatus, question),
      feedbackPdfUrl: assessmentFeedbackPdfUrl(activityId, pupilId),
    }),
  }
}

/**
 * Why `userId` may not flag (or unflag) this question, or the submission's
 * activity when they may. The rules follow what the pupil's lesson page
 * shows: their own latest attempt, a question on the activity, feedback
 * released to them, and a mark on the question that they can see. Not in a
 * locked lesson.
 */
export async function pupilQuestionFlagRefusal(
  submissionId: string,
  questionId: string,
  userId: string,
): Promise<{ error: string } | { activityId: string }> {
  const { rows } = await query<{
    activity_id: string
    user_id: string
    type: string | null
    mark_status: string | null
    submission_status: string | null
    latest_id: string
  }>(
    `select s.activity_id, s.user_id, a.type, s.mark_status, s.submission_status,
            (select l.submission_id from submissions l
              where l.activity_id = s.activity_id and l.user_id = s.user_id
              order by l.attempt_number desc, l.submitted_at desc nulls last, l.submission_id desc
              limit 1) as latest_id
       from submissions s join activities a on a.activity_id = s.activity_id
      where s.submission_id = $1`,
    [submissionId],
  )
  const submission = rows[0]
  if (!submission) return { error: "Submission not found." }
  if (submission.user_id !== userId) return { error: "You can only flag your own work." }
  if (!isQuestionMarkedActivityType(submission.type)) return { error: "This activity has no questions to flag." }
  if (submission.latest_id !== submissionId) return { error: "Only your latest answer can be flagged." }

  const { rows: questionRows } = await query<{ awarded: number | null; provenance: string | null }>(
    `select qm.awarded, qm.provenance
       from activity_questions q
       left join submission_question_marks qm on qm.submission_id = $2 and qm.question_id = q.question_id
      where q.question_id::text = $1 and q.activity_id = $3`,
    [questionId, submissionId, submission.activity_id],
  )
  const question = questionRows[0]
  if (!question) return { error: "That question is not on this activity." }

  if (!(await pupilFeedbackVisible(submission.activity_id, userId))) {
    return { error: "Your feedback has not been released yet." }
  }
  // As the lesson page shows marks: a practical task never before hand-in or
  // while it is being marked (no feedback shows then), and only a question
  // with a mark.
  const powerPointState = powerPointMarkState(submission.submission_status === "submitted", submission.mark_status)
  const shown = isPracticalAssessmentType(submission.type)
    ? question.awarded !== null &&
      powerPointState !== "waiting" &&
      powerPointState !== "not-handed-in" &&
      powerPointQuestionShownToPupil(powerPointState, question)
    : assessmentPaperQuestionShownToPupil(submission.mark_status, question)
  if (!shown) return { error: "This question has not been marked yet." }

  if (await isActivityLockedForUser(userId, submission.activity_id)) return { error: LESSON_LOCKED_MESSAGE }
  return { activityId: submission.activity_id }
}
