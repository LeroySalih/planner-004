import { performance } from "node:perf_hooks"

import { requireTeacherProfile } from "@/lib/auth"
import { registerSseClient } from "@/lib/sse/hub"
import { fetchRecentSseEvents } from "@/lib/sse/persistence"
import type { SseTopic } from "@/lib/sse/types"
import { withTelemetry } from "@/lib/telemetry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TOPIC: SseTopic = "test-sse"

export async function GET(request: Request) {
  await requireTeacherProfile({ refreshSessionCookie: true })
  const authEnd = performance.now()
  const history = await fetchRecentSseEvents([TOPIC])

  return withTelemetry(
    { routeTag: "/test-sse/stream", functionName: "testSseStream", params: { topic: TOPIC }, authEndTime: authEnd },
    async () =>
      new Response(registerSseClient([TOPIC], { initialEvents: history, signal: request.signal }), {
        headers: {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      }),
  )
}
