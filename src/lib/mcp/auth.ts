import { timingSafeEqual } from "node:crypto"
import type { NextRequest } from "next/server"

import { protectedResourceMetadataUrl } from "@/lib/oauth/metadata"
import { verifyAccessToken } from "@/lib/oauth/server"
import { publicOrigin } from "@/lib/public-origin"

type AuthResult =
  | {
      authorized: true
      /** The teacher an OAuth token acts for; null for the service key. */
      userId: string | null
    }
  | { authorized: false; reason: string }

const HEADER_KEYS = ["authorization", "x-mcp-service-key"]

function extractToken(headerValue: string | null): string | null {
  if (!headerValue) return null
  const trimmed = headerValue.trim()
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice(7).trim()
  }
  return trimmed.length > 0 ? trimmed : null
}

function matchesServiceKey(candidate: string, key: string): boolean {
  const a = Buffer.from(candidate)
  const b = Buffer.from(key)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Accepts the MCP_SERVICE_KEY (scripts, header-configured clients) or an OAuth
 * access token issued to a teacher through /oauth/authorize.
 */
export async function verifyMcpAuthorization(request: NextRequest): Promise<AuthResult> {
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
    if (token && matchesServiceKey(token, configuredKey)) {
      return { authorized: true, userId: null }
    }
  }

  const bearer = extractToken(request.headers.get("authorization"))
  if (bearer) {
    const userId = await verifyAccessToken(bearer)
    if (userId) return { authorized: true, userId }
  }

  return { authorized: false, reason: "Missing or invalid MCP credentials." }
}

/** RFC 9728 §5.1: points a client that was refused at where to sign in. */
export function mcpChallengeHeaders(request: NextRequest): Record<string, string> {
  return {
    "WWW-Authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl(publicOrigin(request.headers))}"`,
  }
}
