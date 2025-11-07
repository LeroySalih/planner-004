"use server"

import { z } from "zod"

import { ReportDatasetSchema, buildDatasetUnitSummaries, buildFeedbackMapFromDataset } from "@/app/reports/[pupilId]/report-data"
import { withTelemetry } from "@/lib/telemetry"
import { createSupabaseServiceClient } from "@/lib/supabase/server"

const PupilReportRecalcInput = z.object({
  pupilId: z.string().min(1),
  reason: z.string().optional(),
})

const PupilReportRecalcResult = z.object({
  success: z.literal(true),
  error: z.null(),
})

export type PupilReportRecalcResult = z.infer<typeof PupilReportRecalcResult>

export async function runPupilReportRecalcAction(input: z.infer<typeof PupilReportRecalcInput>) {
  const payload = PupilReportRecalcInput.parse(input)
  const supabase = createSupabaseServiceClient()

  return withTelemetry(
    {
      routeTag: "reports",
      functionName: "runPupilReportRecalcAction",
      params: { pupilId: payload.pupilId, reason: payload.reason ?? null },
    },
    async () => {
      const { data, error } = await supabase.rpc("reports_recalculate_pupil_cache", {
        p_pupil_id: payload.pupilId,
      })

      if (error) {
        console.error("[reports] Failed to recalculate pupil cache", {
          pupilId: payload.pupilId,
          error,
        })
        throw new Error(error.message ?? "Unable to recalculate report cache")
      }

      const dataset = ReportDatasetSchema.parse(data ?? {})
      const feedbackByCriterion = buildFeedbackMapFromDataset(dataset.feedback)
      const unitSummaries = await buildDatasetUnitSummaries({
        dataset,
        pupilId: payload.pupilId,
        feedbackByCriterion,
      })

      const { error: storeError } = await supabase.rpc("reports_store_pupil_unit_summaries", {
        p_pupil_id: payload.pupilId,
        p_units: unitSummaries.map((unit) => ({
          unitId: unit.unitId,
          unitTitle: unit.unitTitle,
          unitSubject: unit.unitSubject,
          unitDescription: unit.unitDescription,
          unitYear: unit.unitYear,
          relatedGroups: unit.relatedGroups,
          groupedLevels: unit.groupedLevels,
          workingLevel: unit.workingLevel,
          activitiesAverage: unit.activitiesAverage,
          assessmentAverage: unit.assessmentAverage,
          assessmentLevel: unit.assessmentLevel,
          scoreError: unit.scoreError,
          objectiveError: unit.objectiveError ?? null,
        })),
      })

      if (storeError) {
        console.error("[reports] Failed to persist unit summaries", {
          pupilId: payload.pupilId,
          error: storeError,
        })
        throw new Error(storeError.message ?? "Unable to store report summaries")
      }

      return PupilReportRecalcResult.parse({ success: true, error: null })
    },
  )
}
