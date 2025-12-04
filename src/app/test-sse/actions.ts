"use server"

import { incrementCounter } from "@/lib/sse-hub"
import { withTelemetry } from "@/lib/telemetry"

export type TestSseActionState = {
  status: "idle" | "updated" | "error"
  counter: number
  message?: string
}

export async function incrementCounterAction(
  prevState: TestSseActionState,
): Promise<TestSseActionState> {
  try {
    const nextCounter = await withTelemetry(
      { routeTag: "/test-sse", functionName: "incrementCounterAction" },
      async () => incrementCounter(),
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
