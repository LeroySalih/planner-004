"use server"

import { z } from "zod"

import { createSupabaseServerClient } from "@/lib/supabase/server"
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

const DetailHomeworkActivitySchema = z.object({
  activity_id: z.string(),
  lesson_id: z.string(),
  title: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  order_by: z.number().nullable().optional(),
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
  homeworkActivities: z.array(DetailHomeworkActivitySchema),
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
      const supabase = await createSupabaseServerClient()
      const { data, error } = await supabase.rpc("pupil_lessons_summary_bootstrap", {
        p_target_user_id: targetPupilId ?? null,
      })

      if (error) {
        console.error("[pupil-lessons] summary bootstrap RPC failed", error)
        return PupilLessonsSummaryBootstrapReturnSchema.parse({
          data: null,
          error: "Unable to load pupil lesson summaries.",
        })
      }

      const parsed = PupilLessonsSummaryBootstrapSchema.safeParse(data)
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
      const supabase = await createSupabaseServerClient()
      const { data, error } = await supabase.rpc("pupil_lessons_detail_bootstrap", {
        p_target_user_id: pupilId,
      })

      if (error) {
        console.error("[pupil-lessons] detail bootstrap RPC failed", { pupilId, error })
        return PupilLessonsDetailBootstrapReturnSchema.parse({
          data: null,
          error: "Unable to load pupil lesson detail.",
        })
      }

      const parsed = PupilLessonsDetailBootstrapSchema.safeParse(data)
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
    },
  )
}
