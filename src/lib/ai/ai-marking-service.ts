import { query } from "@/lib/db";
import { ShortTextSubmissionBodySchema, ShortTextActivityBodySchema } from "@/types";
import { invokeDoAiMarking } from "./do-ai-marking";
import { clampScore, fetchActivitySuccessCriteriaIds, normaliseSuccessCriteriaScores } from "@/lib/scoring/success-criteria";
import { insertPupilActivityFeedbackEntry } from "@/lib/feedback/pupil-activity-feedback";
import { publishAssignmentResultsEvents, type AssignmentResultsRealtimePayload } from "@/lib/results-sse";

const SHORT_TEXT_CORRECTNESS_THRESHOLD = 0.8;

export interface AiMarkingRequest {
  assignmentId: string;
  activityId: string;
  pupilId: string;
  submissionId: string;
}

export async function runAiMarkingFlow(request: AiMarkingRequest): Promise<void> {
  const { assignmentId, activityId, pupilId, submissionId } = request;

  try {
    // 1. Fetch Activity Context
    const { rows: activityRows } = await query(
      `SELECT body_data FROM activities WHERE activity_id = $1 LIMIT 1`,
      [activityId]
    );
    const activity = activityRows[0];
    if (!activity) throw new Error("Activity not found.");

    const parsedActivity = ShortTextActivityBodySchema.safeParse(activity.body_data);
    if (!parsedActivity.success) throw new Error("Invalid activity body data.");

    // 2. Fetch Submission Context
    const { rows: submissionRows } = await query(
      `SELECT body FROM submissions WHERE submission_id = $1 LIMIT 1`,
      [submissionId]
    );
    const submission = submissionRows[0];
    if (!submission) throw new Error("Submission not found.");

    const parsedSubmission = ShortTextSubmissionBodySchema.safeParse(submission.body);
    if (!parsedSubmission.success) throw new Error("Invalid submission body data.");

    const pupilAnswer = parsedSubmission.data.answer || "";
    if (!pupilAnswer.trim()) {
        console.info("[ai-marking] Skipping empty answer for submission:", submissionId);
        return;
    }

    // 3. Invoke AI Marking
    const result = await invokeDoAiMarking({
      question: parsedActivity.data.question,
      model_answer: parsedActivity.data.modelAnswer,
      pupil_answer: pupilAnswer,
    });

    // 4. Calculate Scores
    const successCriteriaIds = await fetchActivitySuccessCriteriaIds(activityId);
    const aiScore = clampScore(result.score);
    const isCorrect = aiScore >= SHORT_TEXT_CORRECTNESS_THRESHOLD;

    const normalizedSuccessScores = normaliseSuccessCriteriaScores({
      successCriteriaIds,
      fillValue: aiScore,
    });

    // 5. Update Submission Body
    const nextBody = ShortTextSubmissionBodySchema.parse({
      ...parsedSubmission.data,
      ai_model_score: aiScore,
      ai_model_feedback: result.feedback || null,
      is_correct: isCorrect,
      success_criteria_scores: normalizedSuccessScores,
    });

    await query(
      `UPDATE submissions SET body = $1 WHERE submission_id = $2`,
      [nextBody, submissionId]
    );

    // 6. Insert Feedback Entry
    await insertPupilActivityFeedbackEntry({
      activityId,
      pupilId,
      submissionId,
      source: "ai",
      score: aiScore,
      feedbackText: result.feedback || null,
      createdBy: null,
    });

    // 7. Broadcast real-time update
    const event: AssignmentResultsRealtimePayload = {
      submissionId,
      pupilId,
      activityId,
      aiScore,
      aiFeedback: result.feedback || null,
      successCriteriaScores: Object.entries(normalizedSuccessScores).reduce<Record<string, number>>((acc, [k, v]) => {
          if (v !== null) acc[k] = v;
          return acc;
      }, {}),
    };

    await publishAssignmentResultsEvents(assignmentId, [event]);

    console.info("[ai-marking] Successfully marked submission:", submissionId);

  } catch (error) {
    console.error("[ai-marking] Flow failed for submission:", submissionId, error);
    // We don't throw here because it's usually called in a fire-and-forget manner
  }
}
