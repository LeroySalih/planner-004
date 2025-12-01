"use server"

import { z } from "zod"

import { ReportDatasetSchema, buildDatasetUnitSummaries, buildFeedbackMapFromDataset } from "@/app/reports/[pupilId]/report-data"
import { withTelemetry } from "@/lib/telemetry"
import { query } from "@/lib/db"

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

  return withTelemetry(
    {
      routeTag: "reports",
      functionName: "runPupilReportRecalcAction",
      params: { pupilId: payload.pupilId, reason: payload.reason ?? null },
    },
    async () => {
      let data: unknown
      try {
        const { rows } = await query("select reports_recalculate_pupil_cache($1) as payload", [
          payload.pupilId,
        ])
        data = rows[0]?.payload ?? {}
      } catch (error) {
        console.error("[reports] Failed to recalculate pupil cache", {
          pupilId: payload.pupilId,
          error,
        })
        const message = error instanceof Error ? error.message : "Unable to recalculate report cache"
        throw new Error(message)
      }

      const dataset = ReportDatasetSchema.parse(data ?? {})
      const feedbackByCriterion = buildFeedbackMapFromDataset(dataset.feedback)
      const unitSummaries = await buildDatasetUnitSummaries({
        dataset,
        pupilId: payload.pupilId,
        feedbackByCriterion,
      })

      try {
        await query(
          "select reports_store_pupil_unit_summaries($1, $2)",
          [
            payload.pupilId,
            unitSummaries.map((unit) => ({
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
          ],
        )
      } catch (error) {
        console.error("[reports] Failed to persist unit summaries", {
          pupilId: payload.pupilId,
          error,
        })
        const message = error instanceof Error ? error.message : "Unable to store report summaries"
        throw new Error(message)
      }

      return PupilReportRecalcResult.parse({ success: true, error: null })
    },
  )
}
