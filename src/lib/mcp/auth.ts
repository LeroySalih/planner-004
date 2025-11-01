import type { NextRequest } from "next/server"

type AuthResult = {
  authorized: boolean
  reason?: string
}

const HEADER_KEYS = ["authorization", "x-mcp-service-key"]

function extractToken(headerValue: string | null): string | null {
  if (!headerValue) return null
  const trimmed = headerValue.trim()
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice(7).trim()
  }
  return trimmed.length > 0 ? trimmed : null
}

export function verifyMcpAuthorization(request: NextRequest): AuthResult {
  const configuredKey = process.env.MCP_SERVICE_KEY

  if (!configuredKey) {
    console.warn("[mcp] MCP_SERVICE_KEY is not configured; allowing request by default")
    return { authorized: true }
  }

  for (const headerKey of HEADER_KEYS) {
    const token = extractToken(request.headers.get(headerKey))
    if (token && token === configuredKey) {
      return { authorized: true }
    }
  }

  return { authorized: false, reason: "Missing or invalid MCP credentials." }
}
