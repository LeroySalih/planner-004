"use server"

import { z } from "zod"

import { hasRole, requireAuthenticatedProfile, requireRole } from "@/lib/auth"
import {
  confirmAssessmentQuestionMarks,
  setTeacherAnswerTranscription,
  setTeacherQuestionCriterionComment,
  setTeacherQuestionCriterionMark,
} from "@/lib/assessment-paper/store"
import { readAssessmentPaperResult, readPupilAssessmentPaperView } from "@/lib/assessment-paper/results"
import { withTelemetry } from "@/lib/telemetry"

// Marking an assessment paper on the results page, and the pupil's own view
// of it on their lesson page. Marks are per criterion within each question;
// the store recomputes the question, the paper's total and the criterion
// roll-up after every change.

const ROUTE_TAG = "/results/assignments:assessment-paper"

const ReadInputSchema = z.object({
  activityId: z.string().min(1),
  pupilId: z.string().min(1),
  /** A particular attempt; the latest when omitted. */
  submissionId: z.string().min(1).nullable().optional(),
})

const MarkInputSchema = z.object({
  submissionId: z.string().min(1),
  questionId: z.string().uuid(),
  successCriteriaId: z.string().min(1),
  awarded: z.number().int().min(0),
})

const CommentInputSchema = z.object({
  submissionId: z.string().min(1),
  questionId: z.string().uuid(),
  successCriteriaId: z.string().min(1),
  feedback: z.string().max(2000).nullable(),
})

const TranscriptionInputSchema = z.object({
  submissionId: z.string().min(1),
  questionId: z.string().uuid(),
  transcription: z.string().max(20000).nullable(),
})

const ConfirmInputSchema = z.object({
  submissionId: z.string().min(1),
  questionId: z.string().uuid(),
})

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? fallback
  return error instanceof Error ? error.message : fallback
}

/** One pupil's paper for the results sidebar: script, questions, criteria, comments. */
export async function readAssessmentPaperMarkingAction(input: z.infer<typeof ReadInputSchema>) {
  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "readAssessmentPaperMarkingAction", params: input },
    async () => {
      await requireRole("teacher")
      try {
        const parsed = ReadInputSchema.parse(input)
        const data = await readAssessmentPaperResult(parsed.activityId, parsed.pupilId, parsed.submissionId)
        return { data, error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to read marking", error)
        return { data: null, error: errorMessage(error, "Unable to load the paper.") }
      }
    },
  )
}

/**
 * A teacher's mark for one criterion within one question. Stamped `teacher`,
 * so a re-mark keeps it. Returns the paper's new total.
 */
export async function setAssessmentQuestionCriterionMarkAction(input: z.infer<typeof MarkInputSchema>) {
  return withTelemetry(
    {
      routeTag: ROUTE_TAG,
      functionName: "setAssessmentQuestionCriterionMarkAction",
      params: { submissionId: input.submissionId, questionId: input.questionId },
    },
    async () => {
      await requireRole("teacher")
      try {
        const parsed = MarkInputSchema.parse(input)
        const totals = await setTeacherQuestionCriterionMark(
          parsed.submissionId,
          parsed.questionId,
          parsed.successCriteriaId,
          parsed.awarded,
        )
        return { data: { totals }, error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to save criterion mark", error)
        return { data: null, error: errorMessage(error, "Unable to save the mark.") }
      }
    },
  )
}

/** A teacher's comment on one criterion within one question; empty clears it. */
export async function setAssessmentQuestionCriterionCommentAction(input: z.infer<typeof CommentInputSchema>) {
  return withTelemetry(
    {
      routeTag: ROUTE_TAG,
      functionName: "setAssessmentQuestionCriterionCommentAction",
      params: { submissionId: input.submissionId, questionId: input.questionId },
    },
    async () => {
      await requireRole("teacher")
      try {
        const parsed = CommentInputSchema.parse(input)
        const feedback = await setTeacherQuestionCriterionComment(
          parsed.submissionId,
          parsed.questionId,
          parsed.successCriteriaId,
          parsed.feedback,
        )
        return { data: { feedback }, error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to save criterion comment", error)
        return { data: null, error: errorMessage(error, "Unable to save the comment.") }
      }
    },
  )
}

/**
 * A teacher's correction of the reader's transcription of one question.
 * Stamped `teacher`, so a re-read keeps it; a re-mark reads it.
 */
export async function setAssessmentAnswerTranscriptionAction(input: z.infer<typeof TranscriptionInputSchema>) {
  return withTelemetry(
    {
      routeTag: ROUTE_TAG,
      functionName: "setAssessmentAnswerTranscriptionAction",
      params: { submissionId: input.submissionId, questionId: input.questionId },
    },
    async () => {
      await requireRole("teacher")
      try {
        const parsed = TranscriptionInputSchema.parse(input)
        const answer = await setTeacherAnswerTranscription(parsed.submissionId, parsed.questionId, parsed.transcription)
        return { data: { answer }, error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to save transcription", error)
        return { data: null, error: errorMessage(error, "Unable to save the transcription.") }
      }
    },
  )
}

/**
 * A teacher confirms the marker's marks on one question without changing
 * them: the rows are stamped `teacher`, so it no longer awaits a check.
 */
export async function confirmAssessmentQuestionAction(input: z.infer<typeof ConfirmInputSchema>) {
  return withTelemetry(
    {
      routeTag: ROUTE_TAG,
      functionName: "confirmAssessmentQuestionAction",
      params: { submissionId: input.submissionId, questionId: input.questionId },
    },
    async () => {
      await requireRole("teacher")
      try {
        const parsed = ConfirmInputSchema.parse(input)
        const totals = await confirmAssessmentQuestionMarks(parsed.submissionId, parsed.questionId)
        return { data: { totals }, error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to confirm question", error)
        return { data: null, error: errorMessage(error, "Unable to confirm the marks.") }
      }
    },
  )
}

/**
 * The pupil's own assessment paper view, for their lesson page: the question
 * paper once sat, the marks and links once feedback is visible. A pupil may
 * read only their own; a teacher may read any pupil's.
 */
export async function readMyAssessmentPaperViewAction(activityId: string, pupilId: string) {
  return withTelemetry(
    { routeTag: "/pupil-lessons:assessment-paper", functionName: "readMyAssessmentPaperViewAction", params: { activityId, pupilId } },
    async () => {
      const profile = await requireAuthenticatedProfile()
      const isTeacher = hasRole(profile, "teacher")
      if (!isTeacher && profile.userId !== pupilId) return { data: null, error: "Not allowed." }
      try {
        const data = await readPupilAssessmentPaperView(activityId, pupilId, isTeacher)
        return { data, error: null }
      } catch (error) {
        console.error("[assessment-paper] failed to read pupil view", error)
        return { data: null, error: errorMessage(error, "Unable to load your paper.") }
      }
    },
  )
}
