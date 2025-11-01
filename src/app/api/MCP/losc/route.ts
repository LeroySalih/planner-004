import { performance } from "node:perf_hooks"

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { verifyMcpAuthorization } from "@/lib/mcp/auth"
import { fetchCurriculumLosc } from "@/lib/mcp/losc"
import { withTelemetry } from "@/lib/telemetry"
import { streamJsonResponse } from "@/lib/mcp/stream"

const ROUTE_TAG = "/api/mcp/losc"

async function resolveCurriculumId(request: NextRequest): Promise<string | null> {
  const url = new URL(request.url)
  const queryId = url.searchParams.get("curriculumId") ?? url.searchParams.get("curriculum_id")
  if (queryId && queryId.trim().length > 0) {
    return queryId.trim()
  }

  if (request.method === "POST") {
    try {
      const payload = await request.json()
      const bodyId =
        typeof payload?.curriculumId === "string"
          ? payload.curriculumId
          : typeof payload?.curriculum_id === "string"
            ? payload.curriculum_id
            : null
      if (bodyId && bodyId.trim().length > 0) {
        return bodyId.trim()
      }
    } catch (error) {
      console.warn("[mcp] Failed to parse LOSC request body", error)
      return null
    }
  }

  return null
}

async function handleRequest(request: NextRequest) {
  const authResult = verifyMcpAuthorization(request)
  const authEnd = performance.now()

  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? "Unauthorized" }, { status: 401 })
  }

  const curriculumId = await resolveCurriculumId(request)

  if (!curriculumId) {
    return NextResponse.json({ error: "curriculumId is required." }, { status: 400 })
  }

  try {
    const payload = await withTelemetry(
      {
        routeTag: ROUTE_TAG,
        functionName: "get_all_los_and_scs",
        params: { curriculumId },
        authEndTime: authEnd,
      },
      async () => {
        const result = await fetchCurriculumLosc(curriculumId)
        return result ? [result] : []
      },
    )

    if (!payload || payload.length === 0) {
      return NextResponse.json({ error: "Curriculum not found." }, { status: 404 })
    }

    return streamJsonResponse(payload)
  } catch (error) {
    console.error("[mcp] Failed to fetch LOSC data", error)
    return NextResponse.json({ error: "Failed to load learning objectives." }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request)
}

export async function POST(request: NextRequest) {
  return handleRequest(request)
}
