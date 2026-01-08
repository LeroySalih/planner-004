"use server"

import { z } from "zod"

import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"

const SummaryPupilSchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
})

const SummaryMembershipSchema = z.object({
  user_id: z.string(),
  group_id: z.string(),
  role: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  group_active: z.boolean().nullable().optional(),
})

const SummaryAssignmentSchema = z.object({
  group_id: z.string(),
  lesson_id: z.string(),
  start_date: z.string().nullable().optional(),
  lesson_title: z.string().nullable().optional(),
  unit_id: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  feedback_visible: z.boolean().nullable().optional(),
})

const PupilLessonsSummaryBootstrapSchema = z.object({
  pupils: z.array(SummaryPupilSchema),
  memberships: z.array(SummaryMembershipSchema),
  lessonAssignments: z.array(SummaryAssignmentSchema),
})

const PupilLessonsSummaryBootstrapReturnSchema = z.object({
  data: PupilLessonsSummaryBootstrapSchema.nullable(),
  error: z.string().nullable(),
})

const DetailMembershipSchema = SummaryMembershipSchema
const DetailAssignmentSchema = SummaryAssignmentSchema.extend({
  user_id: z.string().nullable().optional(),
})

const DetailUnitSchema = z.object({
  unit_id: z.string(),
  title: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
})

const DetailLearningObjectiveSchema = z.object({
  learning_objective_id: z.string(),
  assessment_objective_id: z.string(),
  title: z.string(),
  order_index: z.number().int(),
  active: z.boolean(),
  spec_ref: z.string().nullable().optional(),
  assessment_objective_code: z.string().nullable().optional(),
  assessment_objective_title: z.string().nullable().optional(),
  assessment_objective_order_index: z.number().nullable().optional(),
  assessment_objective_curriculum_id: z.string().nullable().optional(),
  assessment_objective_unit_id: z.string().nullable().optional(),
})

const DetailSuccessCriterionSchema = z.object({
  success_criteria_id: z.string(),
  learning_objective_id: z.string(),
  level: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  order_index: z.number().nullable().optional(),
  active: z.boolean().nullable().optional(),
})

const DetailSuccessCriterionUnitSchema = z.object({
  success_criteria_id: z.string(),
  unit_id: z.string(),
})

const DetailProfileSchema = z
  .object({
    user_id: z.string(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    is_teacher: z.boolean().nullable().optional(),
  })
  .nullable()

const PupilLessonsDetailBootstrapSchema = z.object({
  pupilProfile: DetailProfileSchema,
  memberships: z.array(DetailMembershipSchema),
  lessonAssignments: z.array(DetailAssignmentSchema),
  units: z.array(DetailUnitSchema),
  learningObjectives: z.array(DetailLearningObjectiveSchema),
  successCriteria: z.array(DetailSuccessCriterionSchema),
  successCriteriaUnits: z.array(DetailSuccessCriterionUnitSchema),
})

const PupilLessonsDetailBootstrapReturnSchema = z.object({
  data: PupilLessonsDetailBootstrapSchema.nullable(),
  error: z.string().nullable(),
})

export type PupilLessonsSummaryBootstrap = z.infer<typeof PupilLessonsSummaryBootstrapSchema>
export type PupilLessonsDetailBootstrap = z.infer<typeof PupilLessonsDetailBootstrapSchema>

type TelemetryOptions = { authEndTime?: number | null; routeTag?: string }

export async function readPupilLessonsSummaryBootstrapAction(
  targetPupilId?: string | null,
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/pupil-lessons:summaryBootstrap"

  return withTelemetry(
    {
      routeTag,
      functionName: "readPupilLessonsSummaryBootstrapAction",
      params: { targetPupilId: targetPupilId ?? null },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      try {
        const { rows } = await query<{
          pupils: PupilLessonsSummaryBootstrap["pupils"]
          memberships: PupilLessonsSummaryBootstrap["memberships"]
          lesson_assignments: PupilLessonsSummaryBootstrap["lessonAssignments"]
        }>(
          `
            select *
            from pupil_lessons_summary_bootstrap($1::text)
          `,
          [targetPupilId ?? null],
        )

        const rawRow = rows[0] ?? null
        const payloadValue =
          (rawRow as Record<string, unknown> & { pupil_lessons_summary_bootstrap?: unknown })
            ?.pupil_lessons_summary_bootstrap ??
          (rawRow as Record<string, unknown> & { pupilLessonsSummaryBootstrap?: unknown })
            ?.pupilLessonsSummaryBootstrap ??
          rawRow

        const payload = payloadValue as
          | (typeof rows)[number]
          | Record<string, unknown>
          | null

        if (!payload) {
          return PupilLessonsSummaryBootstrapReturnSchema.parse({
            data: null,
            error: "Unable to load pupil lesson summaries.",
          })
        }

        const lessonAssignments =
          Array.isArray((payload as Record<string, unknown>)?.lesson_assignments)
            ? ((payload as { lesson_assignments: unknown[] }).lesson_assignments as unknown[])
            : (payload as Record<string, unknown> & { lessonAssignments?: unknown[] }).lessonAssignments ?? []

        const normalized = {
          pupils: payload.pupils ?? [],
          memberships: payload.memberships ?? [],
          lessonAssignments,
        }

        const parsed = PupilLessonsSummaryBootstrapSchema.safeParse(normalized)
        if (!parsed.success) {
          console.error("[pupil-lessons] invalid summary bootstrap payload", parsed.error)
          return PupilLessonsSummaryBootstrapReturnSchema.parse({
            data: null,
            error: "Received malformed pupil lesson summary data.",
          })
        }

        return PupilLessonsSummaryBootstrapReturnSchema.parse({
          data: parsed.data,
          error: null,
        })
      } catch (error) {
        console.error("[pupil-lessons] summary bootstrap query failed", error)
        const message = error instanceof Error ? error.message : "Unable to load pupil lesson summaries."
        return PupilLessonsSummaryBootstrapReturnSchema.parse({
          data: null,
          error: message,
        })
      }
    },
  )
}

export async function readPupilLessonsDetailBootstrapAction(
  pupilId: string,
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/pupil-lessons:detailBootstrap"

  return withTelemetry(
    {
      routeTag,
      functionName: "readPupilLessonsDetailBootstrapAction",
      params: { pupilId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      try {
        const { rows } = await query<{
          pupil_profile: PupilLessonsDetailBootstrap["pupilProfile"]
          memberships: PupilLessonsDetailBootstrap["memberships"]
          lesson_assignments: PupilLessonsDetailBootstrap["lessonAssignments"]
          units: PupilLessonsDetailBootstrap["units"]
          learning_objectives: PupilLessonsDetailBootstrap["learningObjectives"]
          success_criteria: PupilLessonsDetailBootstrap["successCriteria"]
          success_criteria_units: PupilLessonsDetailBootstrap["successCriteriaUnits"]
        }>(
          `
            select *
            from pupil_lessons_detail_bootstrap($1::text)
          `,
          [pupilId],
        )

        const rawRow = rows[0] ?? null

        const payloadValue =
          (rawRow as Record<string, unknown> & { pupil_lessons_detail_bootstrap?: unknown })
            ?.pupil_lessons_detail_bootstrap ??
          (rawRow as Record<string, unknown> & { pupilLessonsDetailBootstrap?: unknown })
            ?.pupilLessonsDetailBootstrap ??
          rawRow

        const payload = payloadValue as
          | (typeof rows)[number]
          | Record<string, unknown>
          | null

        if (!payload) {
          return PupilLessonsDetailBootstrapReturnSchema.parse({
            data: null,
            error: "Unable to load pupil lesson detail.",
          })
        }

        const payloadRecord = payload as Record<string, unknown>

        const lessonAssignments =
          Array.isArray((payload as Record<string, unknown>)?.lesson_assignments)
            ? ((payload as { lesson_assignments: unknown[] }).lesson_assignments as unknown[])
            : (payload as Record<string, unknown> & { lessonAssignments?: unknown[] }).lessonAssignments ?? []
        const learningObjectives =
          Array.isArray((payloadRecord as any)?.learning_objectives)
            ? ((payload as { learning_objectives: unknown[] }).learning_objectives as unknown[])
            : (payloadRecord as Record<string, unknown> & { learningObjectives?: unknown[] }).learningObjectives ?? []
        const successCriteria =
          Array.isArray((payloadRecord as any)?.success_criteria)
            ? ((payload as { success_criteria: unknown[] }).success_criteria as unknown[])
            : (payloadRecord as Record<string, unknown> & { successCriteria?: unknown[] }).successCriteria ?? []
        const successCriteriaUnits =
          Array.isArray((payloadRecord as any)?.success_criteria_units)
            ? ((payload as { success_criteria_units: unknown[] }).success_criteria_units as unknown[])
            : (payloadRecord as Record<string, unknown> & { successCriteriaUnits?: unknown[] }).successCriteriaUnits ??
              []

        const normalized = {
          pupilProfile:
            payload.pupil_profile ??
            (payloadRecord as Record<string, unknown> & { pupilProfile?: unknown }).pupilProfile ??
            null,
          memberships: payload.memberships ?? [],
          lessonAssignments,
          units: payload.units ?? [],
          learningObjectives,
          successCriteria,
          successCriteriaUnits,
        }

        const parsed = PupilLessonsDetailBootstrapSchema.safeParse(normalized)
        if (!parsed.success) {
          console.error("[pupil-lessons] invalid detail bootstrap payload", parsed.error)
          return PupilLessonsDetailBootstrapReturnSchema.parse({
            data: null,
            error: "Received malformed pupil lesson detail data.",
          })
        }

        return PupilLessonsDetailBootstrapReturnSchema.parse({
          data: parsed.data,
          error: null,
        })
      } catch (error) {
        console.error("[pupil-lessons] detail bootstrap query failed", { pupilId, error })
        const message = error instanceof Error ? error.message : "Unable to load pupil lesson detail."
        return PupilLessonsDetailBootstrapReturnSchema.parse({
          data: null,
          error: message,
        })
      }
    },
  )
}
