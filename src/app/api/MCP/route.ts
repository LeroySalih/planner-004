import { performance } from "node:perf_hooks"

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { verifyMcpAuthorization } from "@/lib/mcp/auth"
import { withTelemetry } from "@/lib/telemetry"

const ROUTE_TAG = "/api/mcp"

const TOOLS = [
  {
    name: "get_all_curriculum",
    methods: ["GET", "POST"],
    path: "/api/MCP/curriculum",
    description: "Returns an array of curriculum summaries: { curriculum_id, title, is_active }.",
  },
  {
    name: "get_curriculum",
    methods: ["GET", "POST"],
    path: "/api/MCP/curriculum/{curriculumId}",
    description:
      "Returns a single curriculum summary for the provided curriculumId: { curriculum_id, title, is_active }.",
  },
]

async function handleRequest(request: NextRequest) {
  const authResult = verifyMcpAuthorization(request)
  const authEnd = performance.now()

  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? "Unauthorized" }, { status: 401 })
  }

  const payload = await withTelemetry(
    {
      routeTag: ROUTE_TAG,
      functionName: "list_tools",
      authEndTime: authEnd,
    },
    async () => ({ tools: TOOLS }),
  )

  return NextResponse.json(payload, { status: 200 })
}

export async function GET(request: NextRequest) {
  return handleRequest(request)
}

export async function POST(request: NextRequest) {
  return handleRequest(request)
}
