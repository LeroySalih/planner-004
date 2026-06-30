import {
  type GroupItemsResult,
  GroupItemsSubmissionBodySchema,
  LegacyMcqSubmissionBodySchema,
  LongTextSubmissionBodySchema,
  type MatcherPairResult,
  MatcherSubmissionBodySchema,
  McqSubmissionBodySchema,
  ShortTextSubmissionBodySchema,
  UploadSpreadsheetSubmissionBodySchema,
  UploadUrlSubmissionBodySchema,
  UploadWorksheetSubmissionBodySchema,
} from "@/types";
import { clampScore, normaliseSuccessCriteriaScores } from "@/lib/scoring/client-success-criteria";
import { computeSubmissionMarks } from "@/lib/scoring/submission-marks";

export const TEACHER_OVERRIDE_PLACEHOLDER = "__teacher_override__";

// Marks-based fraction derivation, mirroring the simplification already applied to
// lesson_assignment_score_summaries (Phase 1 Task 2): no per-success-criterion sub-averaging,
// use the per-activity marks ratio (marksAwarded / maxMarks) directly.
function deriveFractionsFromMarks(
  submissionBody: unknown,
  activityType: string,
  maxMarks: number,
): {
  autoScore: number | null;
  overrideScore: number | null;
  effectiveScore: number | null;
} {
  const safeMaxMarks = maxMarks > 0 ? maxMarks : 1;
  const record = submissionBody && typeof submissionBody === "object"
    ? (submissionBody as Record<string, unknown>)
    : {};

  const effectiveMarks = computeSubmissionMarks(submissionBody, activityType, safeMaxMarks);
  const effectiveScore = effectiveMarks === null ? null : effectiveMarks / safeMaxMarks;

  const overrideRaw = record.marks_override;
  const overrideMarks = typeof overrideRaw === "number" && Number.isFinite(overrideRaw)
    ? Math.min(Math.max(Math.trunc(overrideRaw), 0), safeMaxMarks)
    : null;
  const overrideScore = overrideMarks === null ? null : overrideMarks / safeMaxMarks;

  // autoScore = effective score computed as if no override were present, i.e. the
  // automatic/AI portion of the priority chain only.
  const bodyWithoutOverride = { ...record };
  delete (bodyWithoutOverride as Record<string, unknown>).marks_override;
  const autoMarks = computeSubmissionMarks(bodyWithoutOverride, activityType, safeMaxMarks);
  const autoScore = autoMarks === null ? null : autoMarks / safeMaxMarks;

  return { autoScore, overrideScore, effectiveScore };
}

function buildMatcherPairResults(
  pairs: import("@/types").MatcherPair[],
  submission: import("@/types").MatcherSubmissionBody,
): MatcherPairResult[] {
  const pairsById = new Map(pairs.map((pair) => [pair.id, pair]));
  const promptSideById = new Map(
    submission.layout.map((entry) => [entry.pairId, entry.promptSide]),
  );

  return pairs.map((pair) => {
    const selectedPairId = submission.answers[pair.id] ?? null;
    const isCorrect = selectedPairId === pair.id;
    const selectedPair = selectedPairId
      ? pairsById.get(selectedPairId) ?? null
      : null;
    const promptSide = promptSideById.get(pair.id) ?? "term";
    const pupilMatchedText = selectedPair
      ? (promptSide === "term" ? selectedPair.definition : selectedPair.term)
      : null;

    return {
      id: pair.id,
      term: pair.term,
      definition: pair.definition,
      isCorrect,
      pupilMatchedText,
    };
  });
}

function buildGroupItemsResults(
  groups: import("@/types").GroupItemsGroup[],
  items: import("@/types").GroupItemsItem[],
  submission: import("@/types").GroupItemsSubmissionBody,
): GroupItemsResult[] {
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));

  return items.map((item) => {
    const pupilGroupId = submission.placements[item.id] ?? null;
    const correctGroupName = groupNameById.get(item.groupId) ?? item.groupId;
    const pupilGroupName = pupilGroupId
      ? groupNameById.get(pupilGroupId) ?? pupilGroupId
      : null;
    const isCorrect = pupilGroupId === item.groupId;

    return {
      id: item.id,
      text: item.text,
      correctGroupName,
      pupilGroupName,
      isCorrect,
    };
  });
}

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
  matcherPairs?: MatcherPairResult[] | null;
  groupItemsResults?: GroupItemsResult[] | null;
};

export function extractScoreFromSubmission(
  activityType: string,
  submissionBody: unknown,
  successCriteriaIds: string[],
  maxMarks: number,
  metadata: {
    question: string | null;
    correctAnswer: string | null;
    optionTextMap?: Record<string, string>;
    matcherPairs?: import("@/types").MatcherPair[];
    groupItemsGroups?: import("@/types").GroupItemsGroup[];
    groupItemsItems?: import("@/types").GroupItemsItem[];
  },
): SubmissionExtraction {
  if (activityType === "multiple-choice-question") {
    const parsed = McqSubmissionBodySchema.safeParse(submissionBody);
    if (parsed.success) {
      const { autoScore: auto, overrideScore: override, effectiveScore } = deriveFractionsFromMarks(
        submissionBody,
        activityType,
        maxMarks,
      );
      const successCriteriaScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        existingScores: parsed.data.success_criteria_scores,
        fillValue: effectiveScore,
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
        effectiveScore,
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

  if (activityType === "matcher") {
    const parsed = MatcherSubmissionBodySchema.safeParse(submissionBody);
    if (parsed.success) {
      const { autoScore: auto, overrideScore: override, effectiveScore } = deriveFractionsFromMarks(
        submissionBody,
        activityType,
        maxMarks,
      );
      const successCriteriaScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        existingScores: parsed.data.success_criteria_scores,
        fillValue: effectiveScore,
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

      const matcherPairs = metadata.matcherPairs
        ? buildMatcherPairResults(metadata.matcherPairs, parsed.data)
        : null;

      return {
        autoScore: auto,
        overrideScore: override,
        effectiveScore,
        autoSuccessCriteriaScores: autoScores,
        overrideSuccessCriteriaScores: overrideScores,
        successCriteriaScores,
        feedback,
        autoFeedback: null,
        question: metadata.question,
        correctAnswer: metadata.correctAnswer,
        pupilAnswer: null,
        matcherPairs,
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
      matcherPairs: null,
    };
  }

  if (activityType === "group-items") {
    const parsed = GroupItemsSubmissionBodySchema.safeParse(submissionBody);
    if (parsed.success) {
      const { autoScore: auto, overrideScore: override, effectiveScore } = deriveFractionsFromMarks(
        submissionBody,
        activityType,
        maxMarks,
      );
      const successCriteriaScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        existingScores: parsed.data.success_criteria_scores,
        fillValue: effectiveScore,
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

      const groupItemsResults = metadata.groupItemsGroups && metadata.groupItemsItems
        ? buildGroupItemsResults(metadata.groupItemsGroups, metadata.groupItemsItems, parsed.data)
        : null;

      return {
        autoScore: auto,
        overrideScore: override,
        effectiveScore,
        autoSuccessCriteriaScores: autoScores,
        overrideSuccessCriteriaScores: overrideScores,
        successCriteriaScores,
        feedback,
        autoFeedback: null,
        question: metadata.question,
        correctAnswer: metadata.correctAnswer,
        pupilAnswer: null,
        groupItemsResults,
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
      groupItemsResults: null,
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
      const { autoScore: auto, overrideScore: override, effectiveScore } = deriveFractionsFromMarks(
        submissionBody,
        activityType,
        maxMarks,
      );
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
        fillValue: effectiveScore,
      });
      const autoScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        fillValue: auto,
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
        effectiveScore,
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

  if (activityType === "upload-spreadsheet" || activityType === "upload-worksheet") {
    const submissionBodySchema = activityType === "upload-worksheet"
      ? UploadWorksheetSubmissionBodySchema
      : UploadSpreadsheetSubmissionBodySchema;
    const parsed = submissionBodySchema.safeParse(submissionBody);
    const fallbackScores = normaliseSuccessCriteriaScores({
      successCriteriaIds,
      fillValue: 0,
    });

    if (parsed.success) {
      const pupilAnswer = parsed.data.fileName?.trim()
        ? `Uploaded: ${parsed.data.fileName.trim()}`
        : null;
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

    const autoRawNum = toNumber(autoRaw);
    const overrideRawNum = toNumber(overrideRaw);
    const auto = typeof autoRawNum === "number" ? clampScore(autoRawNum) : null;
    const override = typeof overrideRawNum === "number" ? clampScore(overrideRawNum) : null;
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
