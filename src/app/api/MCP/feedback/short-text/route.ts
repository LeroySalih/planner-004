import { performance } from "node:perf_hooks"

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { ShortTextFeedbackRequestSchema, type ShortTextFeedbackRequest } from "@/types"
import { verifyMcpAuthorization } from "@/lib/mcp/auth"
import { streamJsonResponse } from "@/lib/mcp/stream"
import { generateShortTextFeedback } from "@/lib/mcp/short-text-feedback"
import { withTelemetry } from "@/lib/telemetry"

const ROUTE_TAG = "/api/mcp/feedback/short-text"

async function handlePost(request: NextRequest) {
  const authResult = verifyMcpAuthorization(request)
  const authEnd = performance.now()

  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? "Unauthorized" }, { status: 401 })
  }

  let parsedBody: ShortTextFeedbackRequest

  try {
    const payload = await request.json()
    const parsed = ShortTextFeedbackRequestSchema.safeParse(payload)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid feedback request payload." }, { status: 400 })
    }
    parsedBody = parsed.data
  } catch (error) {
    console.error("[mcp-feedback] Failed to parse request payload:", error)
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  try {
    const responsePayload = await withTelemetry(
      {
        routeTag: ROUTE_TAG,
        functionName: "feedback_short_text",
        params: {
          assignment_id: parsedBody.assignment_id,
          activity_id: parsedBody.activity_id,
          pupil_id: parsedBody.pupil_id,
        },
        authEndTime: authEnd,
      },
      async () => generateShortTextFeedback(parsedBody),
    )

    return streamJsonResponse(responsePayload)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate feedback."
    const status = message.includes("required to score submissions") ? 400 : 500
    console.error("[mcp-feedback] Failed to generate short-text feedback:", error)
    return NextResponse.json({ error: status === 400 ? message : "Unable to generate feedback." }, { status })
  }
}

export async function POST(request: NextRequest) {
  return handlePost(request)
}
