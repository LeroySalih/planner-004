"use server"

import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"

import { z } from "zod"

import { FastUiActionStateSchema, FastUiRealtimePayloadSchema } from "@/types"
import type { FastUiActionState } from "@/types"

import { requireTeacherProfile } from "@/lib/auth"
import { FAST_UI_MAX_COUNTER } from "@/lib/prototypes/fast-ui"
import { emitFastUiEvent } from "@/lib/sse/topics"
import { withTelemetry } from "@/lib/telemetry"

const ROUTE_TAG = "/prototypes/fast-ui"
const SUCCESS_EVENT = "fast_ui:completed"
const ERROR_EVENT = "fast_ui:error"
const SIMULATED_DELAY_MS = 10_000

const FormInputSchema = z.object({
  counter: z.coerce.number().int().min(0).default(0),
})

async function delay(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function scheduleSimulatedJob({
  jobId,
  counterValue,
  userId,
}: {
  jobId: string
  counterValue: number
  userId: string
}) {
  try {
    await delay(SIMULATED_DELAY_MS)

    const payload = FastUiRealtimePayloadSchema.parse({
      job_id: jobId,
      status: "completed",
      counter_value: counterValue,
      message: "Counter update completed",
    })

    await emitFastUiEvent(SUCCESS_EVENT, payload)
    console.info("[fast-ui] job completed", { jobId, userId, counterValue })
  } catch (error) {
    console.error("[fast-ui] job failure", { jobId, userId, error })

    try {
      const errorPayload = FastUiRealtimePayloadSchema.parse({
        job_id: jobId,
        status: "error",
        counter_value: counterValue,
        message: "Failed to complete counter update",
      })

      await emitFastUiEvent(ERROR_EVENT, errorPayload)
    } catch (notifyError) {
      console.error("[fast-ui] failed to publish error event", { jobId, notifyError })
    }
  }
}

export async function triggerFastUiUpdateAction(
  _prevState: FastUiActionState,
  formData: FormData,
): Promise<FastUiActionState> {
  const profile = await requireTeacherProfile()
  const authEnd = performance.now()
  const rawCounter = formData.get("counter")
  const counterTelemetryValue =
    typeof rawCounter === "string" && rawCounter.trim().length > 0 ? Number(rawCounter) : null

  return withTelemetry(
    {
      routeTag: ROUTE_TAG,
      functionName: "triggerFastUiUpdateAction",
      params: { userId: profile.userId, counter: counterTelemetryValue },
      authEndTime: authEnd,
    },
    async () => {
      const parsedInput = FormInputSchema.safeParse({
        counter: rawCounter,
      })

      if (!parsedInput.success) {
        console.warn("[fast-ui] invalid counter input", { issues: parsedInput.error.issues })
        return FastUiActionStateSchema.parse({
          status: "error",
          jobId: null,
          message: "Invalid counter value",
        })
      }

      const { counter } = parsedInput.data
      if (counter > FAST_UI_MAX_COUNTER) {
        console.warn("[fast-ui] counter limit exceeded", { counter, userId: profile.userId })
        return FastUiActionStateSchema.parse({
          status: "error",
          jobId: null,
          message: `Counter limit of ${FAST_UI_MAX_COUNTER} reached. Please reset before trying again.`,
        })
      }

      const jobId = randomUUID()

      queueMicrotask(() => {
        void scheduleSimulatedJob({
          jobId,
          counterValue: counter,
          userId: profile.userId,
        })
      })

      console.info("[fast-ui] job queued", { jobId, userId: profile.userId, counter })

      return FastUiActionStateSchema.parse({
        status: "queued",
        jobId,
        message: "Update queued",
      })
    },
  )
}
