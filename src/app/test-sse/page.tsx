import { TestSseClient } from "@/components/test-sse/test-sse-client"
import { getCurrentCounter } from "@/lib/sse-hub"

import { incrementCounterAction, type TestSseActionState } from "./actions"

export const dynamic = "force-dynamic"

export default async function TestSsePage() {
  const currentCounter = getCurrentCounter()
  const initialState: TestSseActionState = { status: "idle", counter: currentCounter }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <div className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Labs</p>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Test SSE</h1>
          <p className="text-muted-foreground">
            Open this page in multiple tabs to see server-sent events update a shared counter in
            real time. The button triggers a server action that broadcasts to every subscriber.
          </p>
        </div>
      </div>
      <TestSseClient
        action={incrementCounterAction}
        initialState={initialState}
        streamPath="/test-sse/stream"
      />
    </div>
  )
}
