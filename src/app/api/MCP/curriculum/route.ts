import { performance } from "node:perf_hooks"

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { verifyMcpAuthorization } from "@/lib/mcp/auth"
import { listCurriculumSummaries } from "@/lib/mcp/curriculum"
import { withTelemetry } from "@/lib/telemetry"
import { streamJsonResponse } from "@/lib/mcp/stream"

const ROUTE_TAG = "/api/mcp/curriculum"

async function handleRequest(request: NextRequest) {
  const authResult = verifyMcpAuthorization(request)
  const authEnd = performance.now()

  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? "Unauthorized" }, { status: 401 })
  }

  try {
    const payload = await withTelemetry(
      {
        routeTag: ROUTE_TAG,
        functionName: "get_all_curriculum",
        authEndTime: authEnd,
      },
      () => listCurriculumSummaries(),
    )

    return streamJsonResponse(payload)
  } catch (error) {
    console.error("[mcp] Failed to list curriculum", error)
    return NextResponse.json({ error: "Failed to load curriculum" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request)
}

export async function POST(request: NextRequest) {
  return handleRequest(request)
}
