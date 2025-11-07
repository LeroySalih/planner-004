import { z } from "zod"

import { runPupilReportRecalcAction } from "@/lib/server-actions/reports"

const ScheduleInput = z.object({
  pupilId: z.string().min(1),
  reason: z.string().optional(),
})

export function schedulePupilReportRecalc(input: z.infer<typeof ScheduleInput>) {
  const payload = ScheduleInput.parse(input)

  queueMicrotask(() => {
    void runPupilReportRecalcAction(payload).catch((error) => {
      console.error("[reports] Failed to run background report cache refresh", {
        pupilId: payload.pupilId,
        reason: payload.reason ?? null,
        error,
      })
    })
  })
}
