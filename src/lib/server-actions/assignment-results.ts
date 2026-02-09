"use server";

import { performance } from "node:perf_hooks";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AssignmentResultActivitySchema,
  AssignmentResultCellSchema,
  AssignmentResultCriterionScoresSchema,
  AssignmentResultMatrixSchema,
  AssignmentResultRowSchema,
  McqActivityBodySchema,
  McqSubmissionBodySchema,
  ShortTextActivityBodySchema,
  ShortTextSubmissionBodySchema,
  UploadUrlActivityBodySchema,
} from "@/types";
import { query } from "@/lib/db";
import { createLocalStorageClient } from "@/lib/storage/local-storage";
import { requireTeacherProfile } from "@/lib/auth";
import {
  computeAverageSuccessCriteriaScore,
  fetchActivitySuccessCriteriaIds,
  normaliseSuccessCriteriaScores,
} from "@/lib/scoring/success-criteria";
import { isScorableActivityType } from "@/dino.config";
import {
  extractScoreFromSubmission,
  selectLatestSubmission,
  TEACHER_OVERRIDE_PLACEHOLDER,
} from "@/lib/scoring/activity-scores";
import { withTelemetry } from "@/lib/telemetry";
import { publishAssignmentFeedbackVisibilityUpdate } from "@/lib/results-sse";
import {
  type FeedbackLookupKey,
  type FeedbackLookupMap,
  fetchPupilActivityFeedbackMap,
  insertPupilActivityFeedbackEntry,
  selectLatestFeedbackEntry,
} from "@/lib/feedback/pupil-activity-feedback";

const ASSIGNMENT_ID_SEPARATOR = "__";
const SHORT_TEXT_ACTIVITY_TYPE = "short-text-question";
const SHORT_TEXT_CORRECTNESS_THRESHOLD = 0.8;
const LESSON_FILES_BUCKET = "lessons";
const AssignmentIdentifierSchema = z.object({
  assignmentId: z.string().min(3),
});

const AssignmentFeedbackVisibilityInputSchema = z.object({
  assignmentId: z.string().min(3),
  feedbackVisible: z.boolean(),
});

const AssignmentFeedbackVisibilityResultSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
  feedbackVisible: z.boolean().optional(),
});

const AssignmentOverrideInputSchema = z.object({
  assignmentId: z.string().min(3),
  activityId: z.string().min(1),
  pupilId: z.string().min(1),
  submissionId: z.string().min(1).nullable(),
  score: z.number().min(0).max(1),
  feedback: z.string().trim().max(2000).nullable().optional(),
  criterionScores: AssignmentResultCriterionScoresSchema.optional(),
});

const AssignmentResetInputSchema = z.object({
  assignmentId: z.string().min(3),
  activityId: z.string().min(1),
  pupilId: z.string().min(1),
  submissionId: z.string().min(1).nullable(),
});

const AssignmentResultsReturnSchema = z.object({
  data: AssignmentResultMatrixSchema.nullable(),
  error: z.string().nullable(),
});

const ClearAiMarksInputSchema = z.object({
  assignmentId: z.string().min(3),
  activityId: z.string().min(1),
});

const ClearAiMarksResultSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
  cleared: z.number().int().min(0),
});

const MutateAssignmentScoreReturnSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
  submissionId: z.string().nullable().optional(),
});

type ParsedAssignmentKey = {
  groupId: string;
  lessonId: string;
};

function decodeAssignmentId(raw: string): ParsedAssignmentKey | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const [groupId, lessonId] = trimmed.split(ASSIGNMENT_ID_SEPARATOR);
  if (!groupId || !lessonId) {
    return null;
  }

  return { groupId, lessonId };
}

function buildDisplayName(
  firstName: string | null,
  lastName: string | null,
  fallback: string,
) {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  const combined = `${first} ${last}`.trim();
  return combined.length > 0 ? combined : fallback;
}

function normaliseTimestamp(value: unknown): string | null {
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

function normaliseDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString().split("T")[0];
    }
  }
  return null;
}

function normaliseRichText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const withoutEntities = value.replace(/&nbsp;/gi, " ");
  const withoutTags = withoutEntities.replace(/<[^>]*>/g, " ");
  const normalised = withoutTags.replace(/\s+/g, " ").trim();
  return normalised.length > 0 ? normalised : null;
}

function extractUploadInstructions(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  return normaliseRichText(record.instructions);
}

function computeShortTextCorrectness(score: number | null): boolean {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return false;
  }
  return score >= SHORT_TEXT_CORRECTNESS_THRESHOLD;
}

function buildSubmissionDirectoryPath(
  lessonId: string,
  activityId: string,
  pupilId: string,
) {
  return `lessons/${lessonId}/activities/${activityId}/${pupilId}`;
}

function buildLegacySubmissionDirectoryPath(
  lessonId: string,
  activityId: string,
  pupilId: string,
) {
  return `${lessonId}/activities/${activityId}/${pupilId}`;
}

function isStorageNotFoundError(error: { message?: string } | null) {
  if (!error?.message) {
    return false;
  }
  const normalized = error.message.toLowerCase();
  return normalized.includes("not found") ||
    normalized.includes("object not found");
}

export async function readAssignmentResultsAction(
  assignmentId: string,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  await requireTeacherProfile();
  const authEndTime = options?.authEndTime ?? performance.now();
  const routeTag = options?.routeTag ?? "/results/assignments";

  return withTelemetry(
    {
      routeTag,
      functionName: "readAssignmentResultsAction",
      params: { assignmentId },
      authEndTime,
    },
    async () => {
      const parsedInput = AssignmentIdentifierSchema.safeParse({
        assignmentId,
      });
      if (!parsedInput.success) {
        return AssignmentResultsReturnSchema.parse({
          data: null,
          error: "Invalid assignment identifier.",
        });
      }

      const identifiers = decodeAssignmentId(parsedInput.data.assignmentId);
      if (!identifiers) {
        return AssignmentResultsReturnSchema.parse({
          data: null,
          error: "Assignment not found.",
        });
      }

      const { groupId, lessonId } = identifiers;

      try {
        const [groupRowResult, lessonRowResult, assignmentRowResult] =
          await Promise.all([
            query(
              "select group_id, subject from groups where group_id = $1 limit 1",
              [groupId],
            ),
            query(
              "select lesson_id, unit_id, title from lessons where lesson_id = $1 limit 1",
              [lessonId],
            ),
            query(
              "select group_id, lesson_id, start_date, feedback_visible from lesson_assignments where group_id = $1 and lesson_id = $2 limit 1",
              [groupId, lessonId],
            ),
          ]);

        const groupRow = groupRowResult.rows?.[0] ?? null;
        const lessonRow = lessonRowResult.rows?.[0] ?? null;
        const assignmentRow = assignmentRowResult.rows?.[0] ?? null;

        if (!groupRow || !lessonRow) {
          return AssignmentResultsReturnSchema.parse({
            data: null,
            error: "Assignment context not found.",
          });
        }

        let membershipRows: Array<{ user_id: string; role: string | null }> =
          [];
        try {
          const { rows } = await query(
            `
              select gm.user_id, ur.role_id as role
              from group_membership gm
              left join user_roles ur on ur.user_id = gm.user_id
              where gm.group_id = $1
            `,
            [groupId],
          );
          membershipRows = (rows ?? [])
            .filter((entry) => typeof entry.user_id === "string")
            .map((entry) => ({
              user_id: entry.user_id as string,
              role: typeof entry.role === "string" ? entry.role : null,
            }));
        } catch (membershipError) {
          console.error(
            "[assignment-results] Failed to load group membership:",
            membershipError,
          );
          return AssignmentResultsReturnSchema.parse({
            data: null,
            error: "Unable to load group membership.",
          });
        }

        const pupilMemberships = (membershipRows ?? []).filter((entry) =>
          entry.role?.toLowerCase() === "pupil"
        );
        const pupilIds = pupilMemberships.map((entry) => entry.user_id).filter((
          id,
        ): id is string => Boolean(id));

        const profilesByUserId = new Map<
          string,
          { firstName: string | null; lastName: string | null }
        >();
        const emailByUserId = new Map<string, string>();

        if (pupilIds.length > 0) {
          try {
            const { rows: profileRows } = await query(
              "select user_id, first_name, last_name, email from profiles where user_id = any($1::text[])",
              [pupilIds],
            );
            for (const profile of profileRows ?? []) {
              if (typeof profile?.user_id !== "string") continue;
              const userId = profile.user_id as string;
              profilesByUserId.set(userId, {
                firstName: typeof profile.first_name === "string"
                  ? profile.first_name
                  : null,
                lastName: typeof profile.last_name === "string"
                  ? profile.last_name
                  : null,
              });
              if (
                typeof profile.email === "string" && profile.email.length > 0
              ) {
                emailByUserId.set(userId, profile.email);
              }
            }
          } catch (profileError) {
            console.error(
              "[assignment-results] Failed to load pupil profiles:",
              profileError,
            );
          }
        }

        const pupils = pupilIds
          .map((userId) => {
            const profile = profilesByUserId.get(userId) ?? null;
            const email = emailByUserId.get(userId) ?? null;
            const displayName = buildDisplayName(
              profile?.firstName ?? null,
              profile?.lastName ?? null,
              email ?? userId,
            );
            return {
              userId,
              displayName,
              firstName: profile?.firstName ?? null,
              lastName: profile?.lastName ?? null,
              email,
            };
          })
          .sort((a, b) =>
            a.displayName.localeCompare(b.displayName, undefined, {
              sensitivity: "base",
            })
          );

        let activityRows: Array<Record<string, any>> = [];
        try {
          const { rows } = await query(
            `
          select activity_id, title, type, order_by, body_data, active, is_summative
          from activities
          where lesson_id = $1 and active = true
          order by order_by asc nulls first
        `,
            [lessonId],
          );
          activityRows = rows ?? [];
        } catch (activityError) {
          console.error(
            "[assignment-results] Failed to load activities:",
            activityError,
          );
          return AssignmentResultsReturnSchema.parse({
            data: null,
            error: "Unable to load lesson activities.",
          });
        }

        const scorableActivities = (activityRows ?? []).filter((activity) =>
          isScorableActivityType(activity.type)
        );

        const activityIds = scorableActivities.map((activity) =>
          activity.activity_id
        );

        const activitySuccessCriteriaMap = new Map<
          string,
          Array<{
            successCriteriaId: string;
            title: string | null;
            description: string | null;
            level: number | null;
          }>
        >();
        const activityQuestionMetadata = new Map<
          string,
          {
            question: string | null;
            correctAnswer: string | null;
            optionTextMap?: Record<string, string>;
          }
        >();

        if (activityIds.length > 0) {
          let activitySuccessCriteriaRows: Array<
            { activity_id: string | null; success_criteria_id: string | null }
          > = [];
          try {
            const { rows } = await query(
              "select activity_id, success_criteria_id from activity_success_criteria where activity_id = any($1::text[])",
              [activityIds],
            );
            activitySuccessCriteriaRows = (rows ?? []).map((row) => ({
              activity_id: typeof row?.activity_id === "string"
                ? row.activity_id
                : null,
              success_criteria_id: typeof row?.success_criteria_id === "string"
                ? row.success_criteria_id
                : null,
            }));
          } catch (activitySuccessCriteriaError) {
            console.error(
              "[assignment-results] Failed to load activity success criteria:",
              activitySuccessCriteriaError,
            );
            return AssignmentResultsReturnSchema.parse({
              data: null,
              error: "Unable to load activity success criteria.",
            });
          }

          const successCriteriaIds = Array.from(
            new Set(
              (activitySuccessCriteriaRows ?? [])
                .map((
                  row,
                ) => (typeof row?.success_criteria_id === "string"
                  ? row.success_criteria_id
                  : null)
                )
                .filter((value): value is string => Boolean(value)),
            ),
          );

          const successCriteriaDetails = new Map<
            string,
            {
              title: string | null;
              description: string | null;
              level: number | null;
            }
          >();

          if (successCriteriaIds.length > 0) {
            try {
              const { rows: successCriteriaRows } = await query(
                "select success_criteria_id, description, level from success_criteria where success_criteria_id = any($1::text[])",
                [successCriteriaIds],
              );
              for (const criterion of successCriteriaRows ?? []) {
                const criterionId =
                  typeof criterion?.success_criteria_id === "string"
                    ? criterion.success_criteria_id
                    : null;
                if (!criterionId) continue;
                successCriteriaDetails.set(criterionId, {
                  title: null,
                  description: typeof criterion.description === "string"
                    ? criterion.description
                    : null,
                  level: typeof criterion.level === "number"
                    ? criterion.level
                    : null,
                });
              }
            } catch (successCriteriaError) {
              console.error(
                "[assignment-results] Failed to load success criteria details:",
                successCriteriaError,
              );
            }
          }

          for (const row of activitySuccessCriteriaRows ?? []) {
            const activityId = typeof row?.activity_id === "string"
              ? row.activity_id
              : null;
            const successCriteriaId =
              typeof row?.success_criteria_id === "string"
                ? row.success_criteria_id
                : null;
            if (!activityId || !successCriteriaId) continue;

            const list = activitySuccessCriteriaMap.get(activityId) ??
              [];

            const detail = successCriteriaDetails.get(successCriteriaId);
            list.push({
              successCriteriaId,
              title: detail?.title ?? null,
              description: detail?.description ?? null,
              level: detail?.level ?? null,
            });
            activitySuccessCriteriaMap.set(activityId, list);
          }
        }

        for (const activity of scorableActivities) {
          const type = (activity.type ?? "").trim();
          let question: string | null = null;
          let correctAnswer: string | null = null;
          let optionTextMap: Record<string, string> | undefined;

          if (type === "multiple-choice-question") {
            const parsedBody = McqActivityBodySchema.safeParse(
              activity.body_data,
            );
            if (parsedBody.success) {
              question = normaliseRichText(parsedBody.data.question);
              optionTextMap = Object.fromEntries(
                parsedBody.data.options.map((
                  option,
                ) => [option.id, option.text?.trim() ?? option.id]),
              );
              const correctOption =
                optionTextMap[parsedBody.data.correctOptionId];
              correctAnswer = correctOption ?? parsedBody.data.correctOptionId;
            }
          } else if (type === "short-text-question") {
            const parsedBody = ShortTextActivityBodySchema.safeParse(
              activity.body_data,
            );
            if (parsedBody.success) {
              question = normaliseRichText(parsedBody.data.question);
              correctAnswer = normaliseRichText(parsedBody.data.modelAnswer) ??
                parsedBody.data.modelAnswer?.trim() ?? null;
            }
          } else if (
            type === "text-question" || type === "long-text-question"
          ) {
            const textField =
              typeof activity.body_data === "object" && activity.body_data
                ? (activity.body_data as Record<string, unknown>)
                : null;
            const rawQuestion = typeof textField?.question === "string"
              ? textField.question
              : typeof textField?.text === "string"
              ? textField.text
              : null;
            question = normaliseRichText(rawQuestion);
          } else if (type === "upload-file" || type === "sketch-render") {
            question = extractUploadInstructions(activity.body_data);
          } else if (type === "upload-url") {
            const parsedBody = UploadUrlActivityBodySchema.safeParse(
              activity.body_data,
            );
            if (parsedBody.success) {
              question = normaliseRichText(parsedBody.data.question);
            }
          }

          activityQuestionMetadata.set(activity.activity_id, {
            question,
            correctAnswer,
            optionTextMap,
          });
        }

        const activities = scorableActivities.map((activity) =>
          AssignmentResultActivitySchema.parse({
            activityId: activity.activity_id,
            title: activity.title ?? "Untitled activity",
            type: (activity.type ?? "").trim(),
            orderIndex: typeof activity.order_by === "number"
              ? activity.order_by
              : null,
            isSummative: (activity.is_summative ?? false) &&
              isScorableActivityType(activity.type),
            successCriteria:
              activitySuccessCriteriaMap.get(activity.activity_id) ?? [],
          })
        );

        const activityMap = new Map(
          activities.map((activity) => [activity.activityId, activity]),
        );
        const activityTypeMap = new Map(
          scorableActivities.map((
            activity,
          ) => [activity.activity_id, activity.type ?? ""]),
        );

        let submissionRows: Array<{
          submission_id: string | null;
          activity_id: string | null;
          user_id: string | null;
          submitted_at: string | Date | null;
          body: unknown;
        }> = [];

        if (activityIds.length > 0 && pupilIds.length > 0) {
          try {
            const { rows } = await query(
              `
            select submission_id, activity_id, user_id, submitted_at, body, is_flagged
            from submissions
            where activity_id = any($1::text[])
              and user_id = any($2::text[])
          `,
              [activityIds, pupilIds],
            );

            submissionRows = (rows ?? []).map((row) => ({
              submission_id: typeof row?.submission_id === "string"
                ? row.submission_id
                : null,
              activity_id: typeof row?.activity_id === "string"
                ? row.activity_id
                : null,
              user_id: typeof row?.user_id === "string" ? row.user_id : null,
              submitted_at: typeof row?.submitted_at === "string" ||
                  row?.submitted_at instanceof Date
                ? row.submitted_at
                : null,
              body: row?.body ?? null,
              is_flagged: Boolean(row?.is_flagged),
            }));
          } catch (submissionsError) {
            console.error(
              "[assignment-results] Failed to load submissions:",
              submissionsError,
            );
            return AssignmentResultsReturnSchema.parse({
              data: null,
              error: "Unable to load submissions.",
            });
          }
        }

        let feedbackLookupMap: FeedbackLookupMap = new Map();
        if (activityIds.length > 0 && pupilIds.length > 0) {
          const feedbackLookup = await fetchPupilActivityFeedbackMap({
            activityIds,
            pupilIds,
          });
          if (feedbackLookup.error) {
            console.error(
              "[assignment-results] Failed to load feedback entries for assignment:",
              feedbackLookup.error,
            );
          } else {
            feedbackLookupMap = feedbackLookup.data;
          }
        }

        const baseCellMap = new Map<
          string,
          z.infer<typeof AssignmentResultCellSchema>
        >();

        for (const pupil of pupils) {
          for (const activity of activities) {
            const successCriteriaIds = activity.successCriteria.map((
              criterion,
            ) => criterion.successCriteriaId);
            const zeroScores = normaliseSuccessCriteriaScores({
              successCriteriaIds,
              fillValue: 0,
            });
            const metadata =
              activityQuestionMetadata.get(activity.activityId) ?? {
                question: null,
                correctAnswer: null,
                optionTextMap: undefined,
              };

            const baseCell = AssignmentResultCellSchema.parse({
              activityId: activity.activityId,
              pupilId: pupil.userId,
              submissionId: null,
              score: 0,
              autoScore: 0,
              overrideScore: null,
              status: "missing",
              submittedAt: null,
              feedback: null,
              feedbackSource: null,
              feedbackUpdatedAt: null,
              autoFeedback: null,
              autoFeedbackSource: null,
              autoFeedbackUpdatedAt: null,
              successCriteriaScores: zeroScores,
              autoSuccessCriteriaScores: zeroScores,
              question: metadata.question,
              correctAnswer: metadata.correctAnswer,
              pupilAnswer: null,
              needsMarking: false,
            });
            baseCellMap.set(
              `${pupil.userId}::${activity.activityId}`,
              baseCell,
            );
          }
        }

        for (const submission of submissionRows) {
          const activityId = submission.activity_id ?? "";
          const pupilId = submission.user_id ?? "";
          if (!activityMap.has(activityId) || !pupilIds.includes(pupilId)) {
            continue;
          }

          const key: FeedbackLookupKey = `${pupilId}::${activityId}`;
          const existingCell = baseCellMap.get(key);
          if (!existingCell) {
            continue;
          }

          const submittedAt = normaliseTimestamp(submission.submitted_at);
          if (!selectLatestSubmission(existingCell, submittedAt)) {
            continue;
          }

          const activity = activityMap.get(activityId);
          if (!activity) {
            continue;
          }

          const activityType = activityTypeMap.get(activityId) ?? "";
          const successCriteriaIds = activity.successCriteria.map((criterion) =>
            criterion.successCriteriaId
          );
          const metadata = activityQuestionMetadata.get(activityId) ?? {
            question: null,
            correctAnswer: null,
            optionTextMap: undefined,
          };
          const extracted = extractScoreFromSubmission(
            activityType,
            submission.body,
            successCriteriaIds,
            metadata,
          );
          const status = typeof extracted.overrideScore === "number"
            ? "override"
            : typeof extracted.effectiveScore === "number"
            ? "auto"
            : "missing";

          const finalScore = computeAverageSuccessCriteriaScore(
            extracted.successCriteriaScores,
          ) ?? extracted.effectiveScore ?? 0;

          const feedbackRows = feedbackLookupMap.get(key);
          const latestTeacherFeedback = selectLatestFeedbackEntry(
            feedbackRows,
            "teacher",
          );
          const latestAutoFeedback = selectLatestFeedbackEntry(feedbackRows, [
            "ai",
            "auto",
          ]);
          const teacherFeedbackText = latestTeacherFeedback?.feedback_text &&
              latestTeacherFeedback.feedback_text.trim().length > 0
            ? latestTeacherFeedback.feedback_text.trim()
            : null;
          const autoFeedbackText = latestAutoFeedback?.feedback_text &&
              latestAutoFeedback.feedback_text.trim().length > 0
            ? latestAutoFeedback.feedback_text.trim()
            : null;
          const resolvedFeedback = teacherFeedbackText ?? extracted.feedback ??
            null;
          const resolvedAutoFeedback = autoFeedbackText ??
            extracted.autoFeedback ?? null;

          baseCellMap.set(
            key,
            AssignmentResultCellSchema.parse({
              activityId,
              pupilId,
              submissionId: submission.submission_id ?? null,
              score: finalScore,
              autoScore: extracted.autoScore ?? finalScore,
              overrideScore: extracted.overrideScore,
              status,
              submittedAt,
              feedback: resolvedFeedback,
              feedbackSource: latestTeacherFeedback?.source ??
                (resolvedFeedback ? "teacher" : null),
              feedbackUpdatedAt: latestTeacherFeedback?.created_at ?? null,
              autoFeedback: resolvedAutoFeedback,
              autoFeedbackSource: latestAutoFeedback?.source ?? null,
              autoFeedbackUpdatedAt: latestAutoFeedback?.created_at ?? null,
              successCriteriaScores: extracted.successCriteriaScores,
              autoSuccessCriteriaScores: extracted.autoSuccessCriteriaScores,
              overrideSuccessCriteriaScores:
                extracted.overrideSuccessCriteriaScores ?? undefined,
              question: extracted.question ?? metadata.question,
              correctAnswer: extracted.correctAnswer ?? metadata.correctAnswer,
              pupilAnswer: extracted.pupilAnswer ?? null,
              needsMarking: Boolean(submission.submission_id) &&
                status === "missing",
              isFlagged: (submission as any).is_flagged ?? false,
            }),
          );
        }

        const resolvedLessonId = typeof lessonRow?.lesson_id === "string"
          ? lessonRow.lesson_id
          : null;
        if (resolvedLessonId) {
          const uploadPresenceChecks: Array<
            { key: string; activityId: string; pupilId: string }
          > = [];
          for (const pupil of pupils) {
            for (const activity of activities) {
              if (activity.type !== "upload-file") {
                continue;
              }
              const key = `${pupil.userId}::${activity.activityId}`;
              const cell = baseCellMap.get(key);
              if (!cell || cell.submissionId) {
                continue;
              }
              uploadPresenceChecks.push({
                key,
                activityId: activity.activityId,
                pupilId: pupil.userId,
              });
            }
          }

          if (uploadPresenceChecks.length > 0) {
            const storage = createLocalStorageClient(LESSON_FILES_BUCKET);
            const pendingUploads = await detectPendingUploadSubmissions(
              storage,
              resolvedLessonId,
              uploadPresenceChecks,
            );
            for (const [cellKey, entry] of pendingUploads.entries()) {
              if (!entry?.hasUploads) {
                continue;
              }
              const target = baseCellMap.get(cellKey);
              if (!target) {
                continue;
              }
              baseCellMap.set(
                cellKey,
                AssignmentResultCellSchema.parse({
                  ...target,
                  submittedAt: target.submittedAt ?? entry.submittedAt,
                  needsMarking: true,
                }),
              );
            }
          }
        }

        const activityTotals = new Map<
          string,
          {
            total: number;
            count: number;
            submittedCount: number;
          }
        >();
        const rows = pupils.map((pupil) => {
          const cells = activities.map((activity) => {
            const key = `${pupil.userId}::${activity.activityId}`;
            const resolved = baseCellMap.get(key);
            if (!resolved) {
              const successCriteriaIds = activity.successCriteria.map((
                criterion,
              ) => criterion.successCriteriaId);
              const zeroScores = normaliseSuccessCriteriaScores({
                successCriteriaIds,
                fillValue: 0,
              });
              const metadata =
                activityQuestionMetadata.get(activity.activityId) ?? {
                  question: null,
                  correctAnswer: null,
                  optionTextMap: undefined,
                };

              return AssignmentResultCellSchema.parse({
                activityId: activity.activityId,
                pupilId: pupil.userId,
                submissionId: null,
                score: 0,
                autoScore: 0,
                overrideScore: null,
                status: "missing",
                submittedAt: null,
                feedback: null,
                autoFeedback: null,
                successCriteriaScores: zeroScores,
                autoSuccessCriteriaScores: zeroScores,
                question: metadata.question,
                correctAnswer: metadata.correctAnswer,
                pupilAnswer: null,
                needsMarking: false,
              });
            }
            const entry = activityTotals.get(activity.activityId) ?? {
              total: 0,
              count: 0,
              submittedCount: 0,
            };
            const numericScore = typeof resolved.score === "number"
              ? resolved.score
              : 0;
            entry.total += numericScore;
            if (resolved.status !== "missing") {
              entry.submittedCount += 1;
            }
            entry.count += 1;
            activityTotals.set(activity.activityId, entry);
            return resolved;
          });

          const activityCount = activities.length;
          const activitiesScore = cells.reduce(
            (acc, cell) =>
              acc + (typeof cell.score === "number" ? cell.score : 0),
            0,
          );
          const averageScore = activityCount > 0
            ? activitiesScore / activityCount
            : null;

          return AssignmentResultRowSchema.parse({
            pupil,
            cells,
            averageScore,
          });
        });

        let overallTotal = 0;
        let overallCount = 0;
        let summativeOverallTotal = 0;
        let summativeOverallCount = 0;

        const activitySummaries = activities.map((activity) => {
          const entry = activityTotals.get(activity.activityId);
          const activitiesAverage = entry && entry.count > 0
            ? entry.total / entry.count
            : null;

          if (entry) {
            overallTotal += entry.total;
            overallCount += entry.count;
            if (activity.isSummative) {
              summativeOverallTotal += entry.total;
              summativeOverallCount += entry.count;
            }
          }

          return {
            activityId: activity.activityId,
            activitiesAverage,
            assessmentAverage: activity.isSummative ? activitiesAverage : null,
            submittedCount: entry?.submittedCount ?? 0,
          };
        });

        const successCriteriaTotals = new Map<
          string,
          {
            total: number;
            count: number;
            summativeTotal: number;
            summativeCount: number;
            submittedCount: number;
            activityIds: Set<string>;
            title: string | null;
            description: string | null;
          }
        >();

        for (const row of rows) {
          for (const cell of row.cells) {
            const activity = activityMap.get(cell.activityId);
            if (!activity) continue;

            for (const criterion of activity.successCriteria) {
              const existing =
                successCriteriaTotals.get(criterion.successCriteriaId) ?? {
                  total: 0,
                  count: 0,
                  summativeTotal: 0,
                  summativeCount: 0,
                  submittedCount: 0,
                  activityIds: new Set<string>(),
                  title: criterion.title ?? null,
                  description: criterion.description ?? null,
                };

              const rawValue =
                cell.successCriteriaScores[criterion.successCriteriaId];
              const numeric =
                typeof rawValue === "number" && Number.isFinite(rawValue)
                  ? rawValue
                  : 0;
              existing.total += numeric;
              existing.count += 1;
              if (activity.isSummative) {
                existing.summativeTotal += numeric;
                existing.summativeCount += 1;
              }
              if (cell.status !== "missing") {
                existing.submittedCount += 1;
              }
              existing.activityIds.add(activity.activityId);

              if (!existing.title && criterion.title) {
                existing.title = criterion.title;
              }
              if (
                (!existing.description ||
                  existing.description.trim().length === 0) &&
                criterion.description
              ) {
                existing.description = criterion.description;
              }

              successCriteriaTotals.set(criterion.successCriteriaId, existing);
            }
          }
        }

        const successCriteriaSummaries = Array.from(
          successCriteriaTotals.entries(),
        ).map(([successCriteriaId, entry]) => ({
          successCriteriaId,
          title: entry.title ?? null,
          description: entry.description ?? null,
          activitiesAverage: entry.count > 0 ? entry.total / entry.count : null,
          assessmentAverage: entry.summativeCount > 0
            ? entry.summativeTotal / entry.summativeCount
            : null,
          submittedCount: entry.submittedCount,
          activityCount: entry.activityIds.size,
        }));

        const result = AssignmentResultMatrixSchema.parse({
          assignmentId: parsedInput.data.assignmentId,
          group: {
            groupId: groupRow.group_id,
            subject: groupRow.subject ?? null,
          },
          lesson: {
            lessonId: lessonRow.lesson_id,
            title: lessonRow.title ?? "Untitled lesson",
            unitId: lessonRow.unit_id ?? null,
          },
          assignment: assignmentRow
            ? {
              groupId: assignmentRow.group_id,
              lessonId: assignmentRow.lesson_id,
              startDate: normaliseDate(assignmentRow.start_date),
              feedbackVisible: Boolean(assignmentRow.feedback_visible),
            }
            : {
              groupId,
              lessonId,
              startDate: null,
              feedbackVisible: false,
            },
          pupils,
          activities,
          rows,
          activitySummaries,
          successCriteriaSummaries,
          overallAverages: {
            activitiesAverage: overallCount > 0
              ? overallTotal / overallCount
              : null,
            assessmentAverage: summativeOverallCount > 0
              ? summativeOverallTotal / summativeOverallCount
              : null,
          },
        });

        return AssignmentResultsReturnSchema.parse({
          data: result,
          error: null,
        });
      } catch (error) {
        console.error(
          "[assignment-results] Unexpected error building results matrix:",
          error,
        );
        return AssignmentResultsReturnSchema.parse({
          data: null,
          error: "Unable to load assignment results.",
        });
      }
    },
  );
}

export async function updateAssignmentFeedbackVisibilityAction(
  input: z.infer<typeof AssignmentFeedbackVisibilityInputSchema>,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  await requireTeacherProfile();
  const authEndTime = options?.authEndTime ?? performance.now();
  const routeTag = options?.routeTag ??
    "/results/assignments/feedbackVisibility";

  return withTelemetry(
    {
      routeTag,
      functionName: "updateAssignmentFeedbackVisibilityAction",
      params: {
        assignmentId: input.assignmentId,
        feedbackVisible: input.feedbackVisible,
      },
      authEndTime,
    },
    async () => {
      const parsed = AssignmentFeedbackVisibilityInputSchema.safeParse(input);
      if (!parsed.success) {
        return AssignmentFeedbackVisibilityResultSchema.parse({
          success: false,
          error: "Invalid assignment identifier.",
        });
      }

      const identifiers = decodeAssignmentId(parsed.data.assignmentId);
      if (!identifiers) {
        return AssignmentFeedbackVisibilityResultSchema.parse({
          success: false,
          error: "Assignment not found.",
        });
      }

      let updatedVisible = parsed.data.feedbackVisible;

      try {
        const { rows } = await query(
          `
            update lesson_assignments
            set feedback_visible = $1
            where group_id = $2 and lesson_id = $3
            returning feedback_visible
          `,
          [
            parsed.data.feedbackVisible,
            identifiers.groupId,
            identifiers.lessonId,
          ],
        );

        const row = rows?.[0];
        if (!row) {
          return AssignmentFeedbackVisibilityResultSchema.parse({
            success: false,
            error: "Unable to update feedback visibility.",
          });
        }
        updatedVisible = Boolean(row.feedback_visible);
      } catch (error) {
        console.error(
          "[assignment-results] Failed to update feedback visibility:",
          error,
        );
        return AssignmentFeedbackVisibilityResultSchema.parse({
          success: false,
          error: "Unable to update feedback visibility.",
        });
      }

      await publishAssignmentFeedbackVisibilityUpdate({
        assignmentId: parsed.data.assignmentId,
        feedbackVisible: updatedVisible,
      });

      return AssignmentFeedbackVisibilityResultSchema.parse({
        success: true,
        error: null,
        feedbackVisible: updatedVisible,
      });
    },
  );
}

type UploadPresenceCheck = {
  key: string;
  activityId: string;
  pupilId: string;
};

type UploadPresenceEntry = {
  hasUploads: boolean;
  submittedAt: string | null;
};

async function resolvePupilStorageKeys(pupilIds: string[]) {
  const map = new Map<string, string>();
  if (pupilIds.length === 0) {
    return map;
  }

  try {
    const { rows } = await query<{ user_id: string; email: string | null }>(
      `
        select user_id, email
        from profiles
        where user_id = any($1::text[])
      `,
      [pupilIds],
    );

    for (const row of rows ?? []) {
      const email = row.email?.trim();
      map.set(row.user_id, email && email.length > 0 ? email : row.user_id);
    }
  } catch (error) {
    console.error(
      "[assignment-results] Failed to resolve pupil emails for storage paths",
      error,
      { pupilIds },
    );
  }

  for (const pupilId of pupilIds) {
    if (!map.has(pupilId)) {
      map.set(pupilId, pupilId);
    }
  }

  return map;
}

async function detectPendingUploadSubmissions(
  storage: ReturnType<typeof createLocalStorageClient>,
  lessonId: string,
  checks: UploadPresenceCheck[],
) {
  const results = new Map<string, UploadPresenceEntry>();
  if (checks.length === 0) {
    return results;
  }

  const pupilIds = Array.from(new Set(checks.map((item) => item.pupilId)));
  const pupilStorageKeys = await resolvePupilStorageKeys(pupilIds);

  for (const check of checks) {
    const pupilKey = pupilStorageKeys.get(check.pupilId) ?? check.pupilId;
    let hasUploads = false;
    let submittedAt: string | null = null;
    const directories = [
      buildSubmissionDirectoryPath(lessonId, check.activityId, pupilKey),
      buildLegacySubmissionDirectoryPath(lessonId, check.activityId, pupilKey),
    ];

    for (const directory of directories) {
      const { data, error } = await storage.list(directory, { limit: 1 });
      if (error) {
        if (isStorageNotFoundError(error)) {
          continue;
        }
        console.error(
          "[assignment-results] Failed to inspect pupil upload submissions:",
          error,
          {
            directory,
          },
        );
        break;
      }
      if (Array.isArray(data) && data.length > 0) {
        hasUploads = true;
        const file = data[0];
        const timestamp = file.updated_at ?? file.created_at ?? null;
        submittedAt = timestamp ? new Date(timestamp).toISOString() : null;
        break;
      }
    }

    results.set(check.key, { hasUploads, submittedAt });
  }

  return results;
}

async function getSubmissionRow(
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
        order by submitted_at desc nulls last
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

export async function overrideAssignmentScoreAction(
  input: z.infer<typeof AssignmentOverrideInputSchema>,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const teacherProfile = await requireTeacherProfile();
  const authEndTime = options?.authEndTime ?? performance.now();
  const routeTag = options?.routeTag ?? "/results/assignments:override";

  return withTelemetry(
    {
      routeTag,
      functionName: "overrideAssignmentScoreAction",
      params: {
        assignmentId: input.assignmentId,
        activityId: input.activityId,
        pupilId: input.pupilId,
      },
      authEndTime,
    },
    async () => {
      const parsed = AssignmentOverrideInputSchema.safeParse(input);
      if (!parsed.success) {
        return MutateAssignmentScoreReturnSchema.parse({
          success: false,
          error: "Invalid override payload.",
        });
      }

      const identifiers = decodeAssignmentId(parsed.data.assignmentId);
      if (!identifiers) {
        return MutateAssignmentScoreReturnSchema.parse({
          success: false,
          error: "Assignment not found.",
        });
      }

      try {
        const { rows: activityRows } = await query(
          "select activity_id, type from activities where activity_id = $1 limit 1",
          [parsed.data.activityId],
        );
        const activityRow = activityRows?.[0] ?? null;

        if (!activityRow) {
          return MutateAssignmentScoreReturnSchema.parse({
            success: false,
            error: "Activity not found.",
          });
        }

        const type = typeof activityRow.type === "string"
          ? activityRow.type.trim()
          : "";

        const successCriteriaIds = await fetchActivitySuccessCriteriaIds(
          parsed.data.activityId,
        );

        const buildOverrideScores = (
          existing?: Record<string, number | null>,
        ) =>
          parsed.data.criterionScores
            ? normaliseSuccessCriteriaScores({
              successCriteriaIds,
              existingScores: parsed.data.criterionScores,
              fillValue: parsed.data.score,
            })
            : normaliseSuccessCriteriaScores({
              successCriteriaIds,
              existingScores: existing,
              fillValue: parsed.data.score,
            });

        const submissionLookup = await getSubmissionRow(
          parsed.data.activityId,
          parsed.data.pupilId,
          parsed.data.submissionId,
        );

        if (submissionLookup.error) {
          console.error(
            "[assignment-results] Failed to load submission for override:",
            submissionLookup.error,
          );
          return MutateAssignmentScoreReturnSchema.parse({
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
              teacher_override_score: parsed.data.score,
              teacher_feedback: parsed.data.feedback ?? null,
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
              teacher_override_score: parsed.data.score,
              teacher_feedback: parsed.data.feedback ?? null,
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
              teacher_override_score: parsed.data.score,
              teacher_feedback: parsed.data.feedback ?? null,
              success_criteria_scores: buildOverrideScores(existingScores),
            };
          }

          return {
            teacher_override_score: parsed.data.score,
            teacher_feedback: parsed.data.feedback ?? null,
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
              parsed.data.activityId,
              parsed.data.pupilId,
              submittedAt,
              nextBody,
            ],
          );

          const insertedSubmission = insertedRows?.[0] ?? null;
          if (!insertedSubmission) {
            return MutateAssignmentScoreReturnSchema.parse({
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
          activityId: parsed.data.activityId,
          pupilId: parsed.data.pupilId,
          submissionId,
          source: "teacher",
          score: parsed.data.score,
          feedbackText: parsed.data.feedback ?? null,
          createdBy: teacherProfile.userId,
        });

        revalidatePath(`/results/assignments/${parsed.data.assignmentId}`);

        return MutateAssignmentScoreReturnSchema.parse({
          success: true,
          error: null,
          submissionId,
        });
      } catch (error) {
        console.error(
          "[assignment-results] Unexpected error overriding score:",
          error,
        );
        return MutateAssignmentScoreReturnSchema.parse({
          success: false,
          error: "Unable to save override.",
        });
      }
    },
  );
}

export async function resetAssignmentScoreAction(
  input: z.infer<typeof AssignmentResetInputSchema>,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const teacherProfile = await requireTeacherProfile();
  const authEndTime = options?.authEndTime ?? performance.now();
  const routeTag = options?.routeTag ?? "/results/assignments:reset";

  return withTelemetry(
    {
      routeTag,
      functionName: "resetAssignmentScoreAction",
      params: {
        assignmentId: input.assignmentId,
        activityId: input.activityId,
        pupilId: input.pupilId,
      },
      authEndTime,
    },
    async () => {
      const parsed = AssignmentResetInputSchema.safeParse(input);
      if (!parsed.success) {
        return MutateAssignmentScoreReturnSchema.parse({
          success: false,
          error: "Invalid reset payload.",
        });
      }

      const identifiers = decodeAssignmentId(parsed.data.assignmentId);
      if (!identifiers) {
        return MutateAssignmentScoreReturnSchema.parse({
          success: false,
          error: "Assignment not found.",
        });
      }

      try {
        const { rows: activityRows } = await query(
          "select activity_id, type from activities where activity_id = $1 limit 1",
          [parsed.data.activityId],
        );
        const activityRow = activityRows?.[0] ?? null;

        if (!activityRow) {
          return MutateAssignmentScoreReturnSchema.parse({
            success: false,
            error: "Activity not found.",
          });
        }

        const submissionLookup = await getSubmissionRow(
          parsed.data.activityId,
          parsed.data.pupilId,
          parsed.data.submissionId,
        );

        if (submissionLookup.error) {
          console.error(
            "[assignment-results] Failed to load submission for reset:",
            submissionLookup.error,
          );
          return MutateAssignmentScoreReturnSchema.parse({
            success: false,
            error: "Unable to load submission.",
          });
        }

        if (!submissionLookup.data) {
          return MutateAssignmentScoreReturnSchema.parse({
            success: false,
            error: "Submission not found for this pupil.",
          });
        }

        const submissionId =
          typeof submissionLookup.data.submission_id === "string"
            ? submissionLookup.data.submission_id
            : null;
        if (!submissionId) {
          return MutateAssignmentScoreReturnSchema.parse({
            success: false,
            error: "Submission not found for this pupil.",
          });
        }
        const body = submissionLookup.data.body ?? {};

        let nextBody: Record<string, unknown> = {};
        const successCriteriaIds = await fetchActivitySuccessCriteriaIds(
          parsed.data.activityId,
        );
        const type = typeof activityRow.type === "string"
          ? activityRow.type.trim()
          : "";

        if (body && typeof body === "object") {
          const record = body as Record<string, unknown>;

          let baseScore = 0;
          let existingScores: Record<string, number | null> | undefined;
          if (type === "multiple-choice-question") {
            const parsedBody = McqSubmissionBodySchema.safeParse(body);
            if (parsedBody.success) {
              baseScore = parsedBody.data.is_correct ? 1 : 0;
              existingScores = parsedBody.data.success_criteria_scores;
            }
          } else if (type === "short-text-question") {
            const parsedBody = ShortTextSubmissionBodySchema.safeParse(body);
            if (
              parsedBody.success &&
              typeof parsedBody.data.ai_model_score === "number"
            ) {
              baseScore = parsedBody.data.ai_model_score;
              existingScores = parsedBody.data.success_criteria_scores;
            }
          } else if (typeof record.teacher_override_score === "number") {
            baseScore = record.teacher_override_score as number;
            const rawScores = record.success_criteria_scores;
            if (rawScores && typeof rawScores === "object") {
              existingScores = rawScores as Record<string, number | null>;
            }
          }

          const successCriteriaScores = normaliseSuccessCriteriaScores({
            successCriteriaIds,
            existingScores,
            fillValue: baseScore,
          });

          nextBody = {
            ...record,
            teacher_override_score: null,
            teacher_feedback: null,
            success_criteria_scores: successCriteriaScores,
          };
        } else {
          const successCriteriaScores = normaliseSuccessCriteriaScores({
            successCriteriaIds,
            fillValue: 0,
          });

          nextBody = {
            teacher_override_score: null,
            teacher_feedback: null,
            success_criteria_scores: successCriteriaScores,
          };
        }

        try {
          await query(
            "update submissions set body = $1 where submission_id = $2",
            [nextBody, submissionId],
          );
        } catch (updateError) {
          console.error(
            "[assignment-results] Failed to reset score override:",
            updateError,
          );
          return MutateAssignmentScoreReturnSchema.parse({
            success: false,
            error: "Unable to reset override.",
          });
        }

        await insertPupilActivityFeedbackEntry({
          activityId: parsed.data.activityId,
          pupilId: parsed.data.pupilId,
          submissionId,
          source: "teacher",
          score: null,
          feedbackText: null,
          createdBy: teacherProfile.userId,
        });

        revalidatePath(`/results/assignments/${parsed.data.assignmentId}`);

        return MutateAssignmentScoreReturnSchema.parse({
          success: true,
          error: null,
        });
      } catch (error) {
        console.error(
          "[assignment-results] Unexpected error resetting score:",
          error,
        );
        return MutateAssignmentScoreReturnSchema.parse({
          success: false,
          error: "Unable to reset override.",
        });
      }
    },
  );
}

export async function clearActivityAiMarksAction(
  input: z.infer<typeof ClearAiMarksInputSchema>,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const teacherProfile = await requireTeacherProfile();
  const parsedInput = ClearAiMarksInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return ClearAiMarksResultSchema.parse({
      success: false,
      error: "Invalid request.",
      cleared: 0,
    });
  }

  const authEndTime = options?.authEndTime ?? performance.now();
  const routeTag = options?.routeTag ?? "/results/assignments";

  return withTelemetry(
    {
      routeTag,
      functionName: "clearActivityAiMarksAction",
      params: {
        assignmentId: parsedInput.data.assignmentId,
        activityId: parsedInput.data.activityId,
      },
      authEndTime,
    },
    async () => {
      const { rows: activityRows } = await query(
        "select activity_id, type from activities where activity_id = $1 limit 1",
        [parsedInput.data.activityId],
      );
      const activityRow = activityRows?.[0] ?? null;

      if (!activityRow) {
        return ClearAiMarksResultSchema.parse({
          success: false,
          error: "Activity not found.",
          cleared: 0,
        });
      }

      const activityType = typeof activityRow.type === "string"
        ? activityRow.type.trim()
        : "";

      if (activityType !== SHORT_TEXT_ACTIVITY_TYPE) {
        return ClearAiMarksResultSchema.parse({
          success: false,
          error: "Only short-text activities support AI marks.",
          cleared: 0,
        });
      }

      let submissions: Array<
        { submission_id: string; body: unknown; user_id: string }
      > = [];
      try {
        const { rows } = await query(
          "select submission_id, body, user_id from submissions where activity_id = $1",
          [parsedInput.data.activityId],
        );
        submissions = (rows ?? [])
          .filter((row) =>
            typeof row?.submission_id === "string" &&
            typeof row?.user_id === "string"
          )
          .map((row) => ({
            submission_id: row.submission_id as string,
            body: row.body ?? null,
            user_id: row.user_id as string,
          }));
      } catch (submissionsError) {
        console.error(
          "[assignment-results] Failed to read submissions for AI clear:",
          submissionsError,
        );
        return ClearAiMarksResultSchema.parse({
          success: false,
          error: "Unable to load submissions.",
          cleared: 0,
        });
      }

      const successCriteriaIds = await fetchActivitySuccessCriteriaIds(
        parsedInput.data.activityId,
      );
      let clearedCount = 0;

      for (const submission of submissions ?? []) {
        const parsedBody = ShortTextSubmissionBodySchema.safeParse(
          submission.body ?? {},
        );
        if (!parsedBody.success) {
          continue;
        }

        const baseBody = parsedBody.data;
        const hasAiMark = typeof baseBody.ai_model_score === "number" ||
          (typeof baseBody.ai_model_feedback === "string" &&
            baseBody.ai_model_feedback.trim().length > 0);

        if (!hasAiMark) {
          continue;
        }

        const overrideScore =
          typeof baseBody.teacher_override_score === "number" &&
            Number.isFinite(baseBody.teacher_override_score)
            ? baseBody.teacher_override_score
            : null;

        const fillValue = overrideScore ?? 0;

        const nextBody = ShortTextSubmissionBodySchema.parse({
          ...baseBody,
          ai_model_score: null,
          ai_model_feedback: null,
          is_correct: computeShortTextCorrectness(overrideScore),
          success_criteria_scores: normaliseSuccessCriteriaScores({
            successCriteriaIds,
            existingScores: baseBody.success_criteria_scores,
            fillValue,
          }),
        });

        try {
          await query(
            "update submissions set body = $1 where submission_id = $2",
            [
              nextBody,
              submission.submission_id,
            ],
          );
        } catch (updateError) {
          console.error(
            "[assignment-results] Failed to clear AI mark for submission:",
            {
              submissionId: submission.submission_id,
              error: updateError,
            },
          );
          continue;
        }

        if (
          typeof submission.user_id === "string" &&
          submission.user_id.trim().length > 0
        ) {
          await insertPupilActivityFeedbackEntry({
            activityId: parsedInput.data.activityId,
            pupilId: submission.user_id,
            submissionId: submission.submission_id ?? null,
            source: "ai",
            score: null,
            feedbackText: null,
            createdBy: teacherProfile.userId,
          });
        }

        clearedCount += 1;
      }

      const assignmentPath = `/results/assignments/${
        encodeURIComponent(parsedInput.data.assignmentId)
      }`;
      revalidatePath(assignmentPath);

      return ClearAiMarksResultSchema.parse({
        success: true,
        error: null,
        cleared: clearedCount,
      });
    },
  );
}
