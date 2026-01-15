import {
  LegacyMcqSubmissionBodySchema,
  LongTextSubmissionBodySchema,
  McqSubmissionBodySchema,
  ShortTextSubmissionBodySchema,
  UploadUrlSubmissionBodySchema,
} from "@/types";
import { normaliseSuccessCriteriaScores } from "@/lib/scoring/client-success-criteria";

export const TEACHER_OVERRIDE_PLACEHOLDER = "__teacher_override__";

export type SubmissionExtraction = {
  autoScore: number | null;
  overrideScore: number | null;
  effectiveScore: number | null;
  autoSuccessCriteriaScores: Record<string, number | null>;
  overrideSuccessCriteriaScores: Record<string, number | null> | null;
  successCriteriaScores: Record<string, number | null>;
  feedback: string | null;
  autoFeedback: string | null;
  question: string | null;
  correctAnswer: string | null;
  pupilAnswer: string | null;
};

export function extractScoreFromSubmission(
  activityType: string,
  submissionBody: unknown,
  successCriteriaIds: string[],
  metadata: {
    question: string | null;
    correctAnswer: string | null;
    optionTextMap?: Record<string, string>;
  },
): SubmissionExtraction {
  if (activityType === "multiple-choice-question") {
    const parsed = McqSubmissionBodySchema.safeParse(submissionBody);
    if (parsed.success) {
      const override = typeof parsed.data.teacher_override_score === "number"
        ? parsed.data.teacher_override_score
        : null;
      const auto = parsed.data.is_correct ? 1 : 0;
      const successCriteriaScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        existingScores: parsed.data.success_criteria_scores,
        fillValue: override ?? auto,
      });
      const overrideScores = typeof override === "number"
        ? normaliseSuccessCriteriaScores({
          successCriteriaIds,
          fillValue: override,
        })
        : null;
      const autoScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        fillValue: auto,
      });
      const feedback = typeof parsed.data.teacher_feedback === "string" &&
          parsed.data.teacher_feedback.trim().length > 0
        ? parsed.data.teacher_feedback.trim()
        : null;
      const autoFeedback = typeof parsed.data.ai_model_feedback === "string" &&
          parsed.data.ai_model_feedback.trim().length > 0
        ? parsed.data.ai_model_feedback.trim()
        : null;
      const questionText = metadata.question;
      const correctAnswerText = metadata.correctAnswer;
      const pupilAnswerId = parsed.data.answer_chosen;
      const isOverridePlaceholder =
        pupilAnswerId === TEACHER_OVERRIDE_PLACEHOLDER;
      const pupilAnswerText = isOverridePlaceholder
        ? null
        : metadata.optionTextMap?.[pupilAnswerId] ?? pupilAnswerId ?? null;
      return {
        autoScore: auto,
        overrideScore: override,
        effectiveScore: override ?? auto,
        autoSuccessCriteriaScores: autoScores,
        overrideSuccessCriteriaScores: overrideScores,
        successCriteriaScores,
        feedback,
        autoFeedback: null,
        question: questionText,
        correctAnswer: correctAnswerText,
        pupilAnswer: pupilAnswerText,
      };
    }

    const legacy = LegacyMcqSubmissionBodySchema.safeParse(submissionBody);
    if (legacy.success) {
      return {
        autoScore: null,
        overrideScore: null,
        effectiveScore: null,
        autoSuccessCriteriaScores: normaliseSuccessCriteriaScores({
          successCriteriaIds,
          fillValue: 0,
        }),
        overrideSuccessCriteriaScores: null,
        successCriteriaScores: normaliseSuccessCriteriaScores({
          successCriteriaIds,
          fillValue: 0,
        }),
        question: metadata.question,
        correctAnswer: metadata.correctAnswer,
        pupilAnswer: null,
        feedback: null,
        autoFeedback: null,
      };
    }

    const fallbackScores = normaliseSuccessCriteriaScores({
      successCriteriaIds,
      fillValue: 0,
    });

    return {
      autoScore: null,
      overrideScore: null,
      effectiveScore: null,
      autoSuccessCriteriaScores: fallbackScores,
      overrideSuccessCriteriaScores: null,
      successCriteriaScores: fallbackScores,
      question: metadata.question,
      correctAnswer: metadata.correctAnswer,
      pupilAnswer: null,
      feedback: null,
      autoFeedback: null,
    };
  }

  if (activityType === "short-text-question") {
    const parsed = ShortTextSubmissionBodySchema.safeParse(submissionBody);
    const record = (submissionBody && typeof submissionBody === "object"
      ? (submissionBody as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    if (parsed.success) {
      const candidateAnswer = parsed.data.answer?.trim() ||
        (typeof record.text === "string" ? record.text.trim() : "") ||
        (typeof record.response === "string" ? record.response.trim() : "");
      const pupilAnswer = candidateAnswer.length > 0 ? candidateAnswer : null;
      const hasAnswer = Boolean(pupilAnswer);
      const auto = typeof parsed.data.ai_model_score === "number" &&
          Number.isFinite(parsed.data.ai_model_score)
        ? parsed.data.ai_model_score
        : hasAnswer
        ? 0
        : null;
      const override = typeof parsed.data.teacher_override_score === "number" &&
          Number.isFinite(parsed.data.teacher_override_score)
        ? parsed.data.teacher_override_score
        : null;
      const feedback = typeof parsed.data.teacher_feedback === "string" &&
          parsed.data.teacher_feedback.trim().length > 0
        ? parsed.data.teacher_feedback.trim()
        : null;
      const autoFeedback = typeof parsed.data.ai_model_feedback === "string" &&
          parsed.data.ai_model_feedback.trim().length > 0
        ? parsed.data.ai_model_feedback.trim()
        : null;
      const successCriteriaScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        existingScores: parsed.data.success_criteria_scores,
        fillValue: override ?? auto ?? 0,
      });
      const autoScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        fillValue: auto ?? 0,
      });
      const overrideScores = typeof override === "number"
        ? normaliseSuccessCriteriaScores({
          successCriteriaIds,
          fillValue: override,
        })
        : null;
      return {
        autoScore: auto,
        overrideScore: override,
        effectiveScore: override ?? auto ?? (hasAnswer ? 0 : null),
        autoSuccessCriteriaScores: autoScores,
        overrideSuccessCriteriaScores: overrideScores,
        successCriteriaScores,
        feedback,
        autoFeedback,
        question: metadata.question,
        correctAnswer: metadata.correctAnswer,
        pupilAnswer,
      };
    }

    const fallbackAnswer =
      typeof record.answer === "string" && record.answer.trim().length > 0
        ? record.answer.trim()
        : typeof record.text === "string" && record.text.trim().length > 0
        ? record.text.trim()
        : typeof record.response === "string" &&
            record.response.trim().length > 0
        ? record.response.trim()
        : null;
    const fallbackScores = normaliseSuccessCriteriaScores({
      successCriteriaIds,
      fillValue: 0,
    });

    return {
      autoScore: null,
      overrideScore: null,
      effectiveScore: null,
      autoSuccessCriteriaScores: fallbackScores,
      overrideSuccessCriteriaScores: null,
      successCriteriaScores: fallbackScores,
      feedback: null,
      autoFeedback: null,
      question: metadata.question,
      correctAnswer: metadata.correctAnswer,
      pupilAnswer: fallbackAnswer,
    };
  }

  if (
    activityType === "long-text-question" || activityType === "text-question"
  ) {
    const parsed = LongTextSubmissionBodySchema.safeParse(submissionBody);
    const fallbackScores = normaliseSuccessCriteriaScores({
      successCriteriaIds,
      fillValue: 0,
    });

    if (parsed.success) {
      const pupilAnswer = parsed.data.answer?.trim() ?? null;
      const hasAnswer = Boolean(pupilAnswer && pupilAnswer.length > 0);
      const successCriteriaScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        existingScores: parsed.data.success_criteria_scores,
        fillValue: hasAnswer ? 0 : null,
      });
      return {
        autoScore: hasAnswer ? 0 : null,
        overrideScore: null,
        effectiveScore: hasAnswer ? 0 : null,
        autoSuccessCriteriaScores: fallbackScores,
        overrideSuccessCriteriaScores: null,
        successCriteriaScores,
        feedback: typeof parsed.data.teacher_feedback === "string" &&
            parsed.data.teacher_feedback.trim().length > 0
          ? parsed.data.teacher_feedback.trim()
          : null,
        autoFeedback: null,
        question: metadata.question,
        correctAnswer: metadata.correctAnswer,
        pupilAnswer,
      };
    }

    return {
      autoScore: null,
      overrideScore: null,
      effectiveScore: null,
      autoSuccessCriteriaScores: fallbackScores,
      overrideSuccessCriteriaScores: null,
      successCriteriaScores: fallbackScores,
      feedback: null,
      autoFeedback: null,
      question: metadata.question,
      correctAnswer: metadata.correctAnswer,
      pupilAnswer: null,
    };
    return {
      autoScore: null,
      overrideScore: null,
      effectiveScore: null,
      autoSuccessCriteriaScores: fallbackScores,
      overrideSuccessCriteriaScores: null,
      successCriteriaScores: fallbackScores,
      feedback: null,
      autoFeedback: null,
      question: metadata.question,
      correctAnswer: metadata.correctAnswer,
      pupilAnswer: null,
    };
  }

  if (activityType === "upload-url") {
    const parsed = UploadUrlSubmissionBodySchema.safeParse(submissionBody);
    const fallbackScores = normaliseSuccessCriteriaScores({
      successCriteriaIds,
      fillValue: 0,
    });

    if (parsed.success) {
      const pupilAnswer = parsed.data.url?.trim() ?? null;
      const hasAnswer = Boolean(pupilAnswer && pupilAnswer.length > 0);
      const successCriteriaScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        existingScores: parsed.data.success_criteria_scores,
        fillValue: hasAnswer ? 0 : null,
      });

      return {
        autoScore: hasAnswer ? 0 : null,
        overrideScore: null,
        effectiveScore: hasAnswer ? 0 : null,
        autoSuccessCriteriaScores: fallbackScores,
        overrideSuccessCriteriaScores: null,
        successCriteriaScores,
        feedback:
          typeof parsed.data.teacher_feedback === "string" &&
            parsed.data.teacher_feedback.trim().length > 0
            ? parsed.data.teacher_feedback.trim()
            : null,
        autoFeedback: null,
        question: metadata.question,
        correctAnswer: metadata.correctAnswer,
        pupilAnswer,
      };
    }

    return {
      autoScore: null,
      overrideScore: null,
      effectiveScore: null,
      autoSuccessCriteriaScores: fallbackScores,
      overrideSuccessCriteriaScores: null,
      successCriteriaScores: fallbackScores,
      feedback: null,
      autoFeedback: null,
      question: metadata.question,
      correctAnswer: metadata.correctAnswer,
      pupilAnswer: null,
    };
  }

  if (submissionBody && typeof submissionBody === "object") {
    const record = submissionBody as Record<string, unknown>;
    const overrideRaw = record.teacher_override_score ?? record.override_score;
    const autoRaw = record.score ?? record.auto_score;

    const toNumber = (value: unknown): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
      return null;
    };

    const auto = toNumber(autoRaw);
    const override = toNumber(overrideRaw);
    const feedback = typeof record.teacher_feedback === "string" &&
        record.teacher_feedback.trim().length > 0
      ? record.teacher_feedback.trim()
      : null;
    const existingScores = record.success_criteria_scores &&
        typeof record.success_criteria_scores === "object"
      ? (record.success_criteria_scores as Record<string, number | null>)
      : undefined;
    const successCriteriaScores = normaliseSuccessCriteriaScores({
      successCriteriaIds,
      existingScores,
      fillValue: override ?? auto ?? 0,
    });
    const autoScores = normaliseSuccessCriteriaScores({
      successCriteriaIds,
      fillValue: auto ?? 0,
    });
    const overrideScores = typeof override === "number"
      ? normaliseSuccessCriteriaScores({
        successCriteriaIds,
        fillValue: override,
      })
      : null;
    const pupilAnswer =
      typeof record.answer === "string" && record.answer.trim().length > 0
        ? record.answer.trim()
        : typeof record.text === "string" && record.text.trim().length > 0
        ? record.text.trim()
        : null;

    return {
      autoScore: auto,
      overrideScore: override,
      effectiveScore: override ?? auto,
      autoSuccessCriteriaScores: autoScores,
      overrideSuccessCriteriaScores: overrideScores,
      successCriteriaScores,
      feedback,
      autoFeedback: null,
      question: metadata.question,
      correctAnswer: metadata.correctAnswer,
      pupilAnswer,
    };
  }

  const fallbackScores = normaliseSuccessCriteriaScores({
    successCriteriaIds,
    fillValue: 0,
  });

  return {
    autoScore: null,
    overrideScore: null,
    effectiveScore: null,
    autoSuccessCriteriaScores: fallbackScores,
    overrideSuccessCriteriaScores: null,
    successCriteriaScores: fallbackScores,
    feedback: null,
    autoFeedback: null,
    question: metadata.question,
    correctAnswer: metadata.correctAnswer,
    pupilAnswer: null,
  };
}

export function selectLatestSubmission(
  existing: { submittedAt: string | null },
  nextSubmittedAt: string | null,
) {
  if (!existing.submittedAt) {
    return true;
  }
  if (!nextSubmittedAt) {
    return false;
  }
  return new Date(nextSubmittedAt).valueOf() >=
    new Date(existing.submittedAt).valueOf();
}
