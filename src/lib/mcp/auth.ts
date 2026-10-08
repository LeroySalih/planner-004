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

  // Fail closed. This used to allow every request when the key was unset,
  // which meant a deploy that lost the variable silently opened the whole
  // database to anyone who found the URL — with nothing but a warning in the
  // logs to say so. MCP_SERVICE_KEY is in REQUIRED_ENV, so a correctly booted
  // server never reaches this; it is here for the paths that skip
  // instrumentation, such as tests and scripts.
  if (!configuredKey) {
    console.error("[mcp] MCP_SERVICE_KEY is not configured; refusing every request")
    return { authorized: false, reason: "MCP is not configured on this server." }
  }

  for (const headerKey of HEADER_KEYS) {
    const token = extractToken(request.headers.get(headerKey))
    if (token && token === configuredKey) {
      return { authorized: true }
    }
  }

  // Claude's custom-connector dialog takes a URL and nothing else, so a
  // machine without Node (and therefore without mcp-remote to add a header)
  // cannot reach a header-only server. A dev site can opt in to `?key=`.
  // Never enable it in production: a key in a URL lands in proxy and access
  // logs, so the site that allows it should have a key of its own.
  if (process.env.MCP_ALLOW_QUERY_KEY === "true") {
    const token = request.nextUrl.searchParams.get("key")
    if (token && token === configuredKey) {
      return { authorized: true }
    }
  }

  return { authorized: false, reason: "Missing or invalid MCP credentials." }
}
