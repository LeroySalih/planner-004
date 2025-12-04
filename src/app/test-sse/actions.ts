"use server"

import { performance } from "node:perf_hooks"

import { requireTeacherProfile } from "@/lib/auth"
import { emitSseEvent, getTopicCounter, setTopicCounter } from "@/lib/sse/hub"
import { fetchLatestSseEvent } from "@/lib/sse/persistence"
import type { SseTopic } from "@/lib/sse/types"
import { withTelemetry } from "@/lib/telemetry"

export type TestSseActionState = {
  status: "idle" | "updated" | "error"
  counter: number
  message?: string
}

const TEST_SSE_TOPIC: SseTopic = "test-sse"

export async function incrementCounterAction(
  prevState: TestSseActionState,
): Promise<TestSseActionState> {
  try {
    const profile = await requireTeacherProfile({ refreshSessionCookie: true })
    const authEnd = performance.now()

    const latest = await fetchLatestSseEvent(TEST_SSE_TOPIC)
    const currentCounter =
      latest && typeof latest.payload?.value === "number"
        ? (latest.payload.value as number)
        : getTopicCounter(TEST_SSE_TOPIC)
    const nextCounter = currentCounter + 1
    setTopicCounter(TEST_SSE_TOPIC, nextCounter)
    await withTelemetry(
      {
        routeTag: "/test-sse",
        functionName: "incrementCounterAction",
        params: { counter: nextCounter },
        authEndTime: authEnd,
      },
      async () =>
        emitSseEvent({
          topic: TEST_SSE_TOPIC,
          type: "demo.counter.incremented",
          payload: { value: nextCounter },
          emittedBy: profile.userId,
        }),
    )

    return {
      status: "updated",
      counter: nextCounter,
      message: `Counter incremented to ${nextCounter}`,
    }
  } catch (error) {
    console.error("[test-sse] failed to increment counter", error)
    return {
      status: "error",
      counter: prevState.counter,
      message: "Something went wrong while sending the event.",
    }
  }
}
