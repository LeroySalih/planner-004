import type { z } from "zod"

import { query } from "@/lib/db"
import { recomputeSubmissionAggregate } from "@/lib/scoring/aggregate-sc-marks"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { insertPupilActivityFeedbackEntry } from "@/lib/feedback/pupil-activity-feedback"
import { TEACHER_OVERRIDE_PLACEHOLDER } from "@/lib/scoring/activity-scores"
import { fetchActivitySuccessCriteriaIds, normaliseSuccessCriteriaScores } from "@/lib/scoring/success-criteria"
import {
  type AssignmentResultCriterionScoresSchema,
  McqSubmissionBodySchema,
  ShortTextSubmissionBodySchema,
} from "@/types"

// The teacher's whole-activity override, shared by the assignment results page
// and the MCP feedback tools so both follow one flow. Callers authorise first:
// nothing here checks who is asking.

export type TeacherActivityOverrideInput = {
  activityId: string
  pupilId: string
  submissionId: string | null
  marksOverride: number
  feedback: string | null
  criterionScores?: z.infer<typeof AssignmentResultCriterionScoresSchema>
}

export type TeacherActivityOverrideResult =
  | { success: true; error: null; submissionId: string | null }
  | { success: false; error: string }

export function normaliseTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return null;
}

export async function getSubmissionRow(
  activityId: string,
  pupilId: string,
  submissionId: string | null,
) {
  try {
    if (submissionId) {
      const { rows } = await query(
        `
          select submission_id, body, submitted_at
          from submissions
          where submission_id = $1
          limit 1
        `,
        [submissionId],
      );

      const data = rows?.[0] ?? null;
      if (data) {
        return { data, error: null };
      }
    }

    const { rows } = await query(
      `
        select submission_id, body, submitted_at
        from submissions
        where activity_id = $1
          and user_id = $2
        order by attempt_number desc
        limit 1
      `,
      [activityId, pupilId],
    );

    const data = rows?.[0] ?? null;
    return { data, error: null };
  } catch (error) {
    console.error("[assignment-results] Failed to load submission row:", error);
    return {
      data: null,
      error: error instanceof Error
        ? error
        : new Error("Unable to load submission."),
    };
  }
}

export async function applyTeacherActivityOverride(
  input: TeacherActivityOverrideInput,
  teacherId: string | null,
): Promise<TeacherActivityOverrideResult> {
  const { rows: activityRows } = await query(
    "select activity_id, type, max_marks from activities where activity_id = $1 limit 1",
    [input.activityId],
  );
  const activityRow = activityRows?.[0] ?? null;

  if (!activityRow) {
    return ({
      success: false,
      error: "Activity not found.",
    });
  }

  const type = typeof activityRow.type === "string"
    ? activityRow.type.trim()
    : "";

  const maxMarks = typeof activityRow.max_marks === "number"
    ? activityRow.max_marks
    : Number(activityRow.max_marks);

  if (
    !Number.isInteger(input.marksOverride) ||
    input.marksOverride < 0 ||
    input.marksOverride > maxMarks
  ) {
    return ({
      success: false,
      error: `marksOverride must be a whole number between 0 and ${maxMarks}`,
    });
  }

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(
    input.activityId,
  );

  const buildOverrideScores = (
    existing?: Record<string, number | null>,
  ) =>
    input.criterionScores
      ? normaliseSuccessCriteriaScores({
        successCriteriaIds,
        existingScores: input.criterionScores,
        fillValue: input.marksOverride,
      })
      : normaliseSuccessCriteriaScores({
        successCriteriaIds,
        existingScores: existing,
        fillValue: input.marksOverride,
      });

  const submissionLookup = await getSubmissionRow(
    input.activityId,
    input.pupilId,
    input.submissionId,
  );

  if (submissionLookup.error) {
    console.error(
      "[assignment-results] Failed to load submission for override:",
      submissionLookup.error,
    );
    return ({
      success: false,
      error: "Unable to load submission.",
    });
  }

  let submissionId =
    typeof submissionLookup.data?.submission_id === "string"
      ? submissionLookup.data.submission_id
      : null;
  let submittedAt =
    normaliseTimestamp(submissionLookup.data?.submitted_at) ??
      new Date().toISOString();
  const currentBody = submissionLookup.data?.body;

  const resolveOverrideBody = (): Record<string, unknown> => {
    if (type === "short-text-question") {
      const snapshot = ShortTextSubmissionBodySchema.safeParse(
        currentBody ?? {},
      );
      const base = snapshot.success
        ? snapshot.data
        : ShortTextSubmissionBodySchema.parse({});
      return {
        ...base,
        marks_override: input.marksOverride,
        teacher_feedback: input.feedback ?? null,
        success_criteria_scores: buildOverrideScores(
          base.success_criteria_scores,
        ),
      };
    }

    if (type === "multiple-choice-question") {
      const snapshot = McqSubmissionBodySchema.safeParse(
        currentBody ?? {},
      );
      const base = snapshot.success
        ? snapshot.data
        : McqSubmissionBodySchema.parse({
          answer_chosen: TEACHER_OVERRIDE_PLACEHOLDER,
          is_correct: false,
          success_criteria_scores: {},
        });
      return {
        ...base,
        marks_override: input.marksOverride,
        teacher_feedback: input.feedback ?? null,
        success_criteria_scores: buildOverrideScores(
          base.success_criteria_scores,
        ),
      };
    }

    if (currentBody && typeof currentBody === "object") {
      const record = currentBody as Record<string, unknown>;
      const existingScores =
        typeof record.success_criteria_scores === "object"
          ? (record.success_criteria_scores as Record<
            string,
            number | null
          >)
          : undefined;
      return {
        ...record,
        marks_override: input.marksOverride,
        teacher_feedback: input.feedback ?? null,
        success_criteria_scores: buildOverrideScores(existingScores),
      };
    }

    return {
      marks_override: input.marksOverride,
      teacher_feedback: input.feedback ?? null,
      success_criteria_scores: buildOverrideScores(),
    };
  };

  let nextBody = resolveOverrideBody();
  const isNewSubmission = !submissionLookup.data;

  if (isNewSubmission) {
    nextBody = {
      ...nextBody,
      teacher_created_submission: true,
    };
  }

  if (submissionId) {
    await query(
      `
        update submissions
        set body = $1, submitted_at = $2
        where submission_id = $3
      `,
      [nextBody, submittedAt, submissionId],
    );
  } else {
    const { rows: insertedRows } = await query(
      `
        insert into submissions (activity_id, user_id, submitted_at, body)
        values ($1, $2, $3, $4)
        returning submission_id, submitted_at
      `,
      [
        input.activityId,
        input.pupilId,
        submittedAt,
        nextBody,
      ],
    );

    const insertedSubmission = insertedRows?.[0] ?? null;
    if (!insertedSubmission) {
      return ({
        success: false,
        error: "Unable to save override.",
      });
    }

    submissionId = typeof insertedSubmission.submission_id === "string"
      ? insertedSubmission.submission_id
      : null;
    submittedAt = normaliseTimestamp(insertedSubmission.submitted_at) ??
      submittedAt;
  }

  await insertPupilActivityFeedbackEntry({
    activityId: input.activityId,
    pupilId: input.pupilId,
    submissionId,
    source: "teacher",
    score: maxMarks > 0 ? input.marksOverride / maxMarks : null,
    feedbackText: input.feedback ?? null,
    createdBy: teacherId,
  });

  return { success: true, error: null, submissionId }
}

/**
 * Override one criterion's marks. The edited row is stamped
 * `provenance='teacher'` so a later re-mark preserves it, and the submission
 * total is recomputed from its criteria.
 */
export async function applyTeacherScMark(input: {
  submissionId: string
  successCriteriaId: string
  awarded: number
  /** Optional teacher comment saved alongside the mark. */
  feedback?: string | null
}) {
  if (!Number.isInteger(input.awarded) || input.awarded < 0) {
    return { data: null, error: "Awarded marks must be a whole number of at least 0." }
  }

  try {
    const { rows: existing } = await query<{ available: number; activity_id: string }>(
      `select m.available, s.activity_id
       from submission_sc_marks m
       join submissions s on s.submission_id = m.submission_id
       where m.submission_id = $1 and m.success_criteria_id = $2
       limit 1`,
      [input.submissionId, input.successCriteriaId],
    )

    const row = existing[0]
    if (!row) {
      return { data: null, error: "No mark exists for that criterion yet." }
    }

    const available = Number(row.available)
    if (input.awarded > available) {
      return {
        data: null,
        error: `Awarded marks cannot exceed ${available} for this criterion.`,
      }
    }

    const trimmedFeedback = typeof input.feedback === "string"
      ? input.feedback.trim()
      : undefined

    await query(
      `update submission_sc_marks
       set awarded = $3,
           provenance = 'teacher',
           teacher_feedback = case when $4::boolean
                                   then nullif($5::text, '')
                                   else teacher_feedback end,
           marked_at = timezone('utc', now())
       where submission_id = $1 and success_criteria_id = $2`,
      [
        input.submissionId,
        input.successCriteriaId,
        input.awarded,
        trimmedFeedback !== undefined,
        trimmedFeedback ?? null,
      ],
    )

    const aggregate = await recomputeSubmissionAggregate(input.submissionId, row.activity_id)

    const { rows: pupilRows } = await query<{ user_id: string }>(
      `select user_id from submissions where submission_id = $1`,
      [input.submissionId],
    )

    void emitSubmissionEvent("submission.updated", {
      submissionId: input.submissionId,
      activityId: row.activity_id,
      pupilId: pupilRows[0]?.user_id ?? "",
      markStatus: "marked",
      markedAt: new Date().toISOString(),
    })

    return {
      data: {
        awarded: input.awarded,
        available,
        aggregate,
      },
      error: null,
    }
  } catch (error) {
    console.error("[sc-marks] updateScMarkAction:error", error)
    return { data: null, error: "Unable to update criterion mark." }
  }
}

/**
 * Set (or clear) a teacher's comment on one criterion, without changing the
 * mark. The submission's combined feedback is refreshed so reports see it too.
 */
export async function applyTeacherScFeedback(input: {
  submissionId: string
  successCriteriaId: string
  feedback: string | null
}) {
  try {
    const { rows } = await query<{ activity_id: string }>(
      `select s.activity_id
       from submission_sc_marks m
       join submissions s on s.submission_id = m.submission_id
       where m.submission_id = $1 and m.success_criteria_id = $2
       limit 1`,
      [input.submissionId, input.successCriteriaId],
    )

    const activityId = rows[0]?.activity_id
    if (!activityId) {
      return { data: null, error: "No mark exists for that criterion yet." }
    }

    const trimmed = input.feedback?.trim() ?? ""

    await query(
      `update submission_sc_marks
       set teacher_feedback = nullif($3::text, ''), marked_at = timezone('utc', now())
       where submission_id = $1 and success_criteria_id = $2`,
      [input.submissionId, input.successCriteriaId, trimmed],
    )

    // Refresh the submission's combined feedback (scores are unchanged).
    await recomputeSubmissionAggregate(input.submissionId, activityId)

    return { data: { feedback: trimmed || null }, error: null }
  } catch (error) {
    console.error("[sc-marks] updateScFeedbackAction:error", error)
    return { data: null, error: "Unable to save criterion feedback." }
  }
}
