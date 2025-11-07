"use server"

import { z } from "zod"

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
      const { error } = await supabase.rpc("reports_recalculate_pupil_cache", {
        p_pupil_id: payload.pupilId,
      })

      if (error) {
        console.error("[reports] Failed to recalculate pupil cache", {
          pupilId: payload.pupilId,
          error,
        })
        throw new Error(error.message ?? "Unable to recalculate report cache")
      }

      return PupilReportRecalcResult.parse({ success: true, error: null })
    },
  )
}
