import { registerSseClient } from "@/lib/sse-hub"
import { withTelemetry } from "@/lib/telemetry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withTelemetry(
    { routeTag: "/test-sse/stream", functionName: "testSseStream" },
    async () =>
      new Response(registerSseClient(request.signal), {
        headers: {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      }),
  )
}
