import { performance } from "node:perf_hooks"

import { requireTeacherProfile } from "@/lib/auth"
import { fetchRecentSseEvents } from "@/lib/sse/persistence"
import { registerSseClient } from "@/lib/sse/hub"
import { SSE_TOPICS, type SseTopic } from "@/lib/sse/types"
import { withTelemetry } from "@/lib/telemetry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseTopics(request: Request): SseTopic[] {
  const url = new URL(request.url)
  const raw = url.searchParams.get("topics")
  if (!raw) return [...SSE_TOPICS]

  const requested = raw
    .split(",")
    .map((topic) => topic.trim())
    .filter((topic): topic is SseTopic => SSE_TOPICS.includes(topic as SseTopic))

  return requested.length > 0 ? requested : [...SSE_TOPICS]
}

export async function GET(request: Request) {
  const topics = parseTopics(request)
  if (topics.length === 0) {
    return new Response("No valid topics provided", { status: 400 })
  }

  const authStart = performance.now()
  const profile = await requireTeacherProfile({ refreshSessionCookie: true })
  const authEnd = performance.now()

  const history = await fetchRecentSseEvents(topics)

  return withTelemetry(
    { routeTag: "/sse/stream", functionName: "sseStream", params: { topics }, authEndTime: authEnd },
    async () =>
      new Response(registerSseClient(topics, { initialEvents: history, signal: request.signal }), {
        headers: {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      }),
  )
}
