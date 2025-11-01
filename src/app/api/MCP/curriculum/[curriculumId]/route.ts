import { performance } from "node:perf_hooks"

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { verifyMcpAuthorization } from "@/lib/mcp/auth"
import { getCurriculumSummary } from "@/lib/mcp/curriculum"
import { withTelemetry } from "@/lib/telemetry"

const ROUTE_TAG = "/api/mcp/curriculum/[curriculumId]"

type RouteContext = {
  params: Promise<{ curriculumId: string }>
}

async function handleRequest(request: NextRequest, context: RouteContext) {
  const authResult = verifyMcpAuthorization(request)
  const authEnd = performance.now()

  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? "Unauthorized" }, { status: 401 })
  }

  const resolvedParams = await context.params
  const curriculumId = resolvedParams.curriculumId?.trim()

  if (!curriculumId) {
    return NextResponse.json({ error: "curriculumId is required." }, { status: 400 })
  }

  try {
    const payload = await withTelemetry(
      {
        routeTag: ROUTE_TAG,
        functionName: "get_curriculum",
        params: { curriculumId },
        authEndTime: authEnd,
      },
      () => getCurriculumSummary(curriculumId),
    )

    if (!payload) {
      return NextResponse.json({ error: "Curriculum not found." }, { status: 404 })
    }

    return NextResponse.json(payload, { status: 200 })
  } catch (error) {
    console.error("[mcp] Failed to fetch curriculum", error)
    return NextResponse.json({ error: "Failed to load curriculum" }, { status: 500 })
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context)
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context)
}
