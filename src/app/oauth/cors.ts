import { NextResponse } from "next/server"

// The token and registration endpoints are called cross-origin by browser-based
// MCP clients. They take no cookies, so a wildcard origin is safe.
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
}

export function oauthJson(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS })
}

/** RFC 6749 §5.2 error shape. */
export function oauthError(error: string, description: string, status = 400): NextResponse {
  return oauthJson({ error, error_description: description }, status)
}

export function oauthPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: HEADERS })
}
