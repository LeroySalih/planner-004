import { NextResponse } from "next/server"

// The /oauth endpoints are called cross-origin by browser-based clients (MCP
// clients and the Kerf apps). They take no cookies, so a wildcard origin is
// safe.
const POST_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
}

const GET_HEADERS = {
  ...POST_HEADERS,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization",
}

export function oauthJson(body: object, status = 200, extraHeaders: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...POST_HEADERS, ...extraHeaders } })
}

/** RFC 6749 §5.2 error shape. */
export function oauthError(error: string, description: string, status = 400): NextResponse {
  return oauthJson({ error, error_description: description }, status)
}

export function oauthPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: POST_HEADERS })
}

/** For the GET endpoints (jwks, userinfo). */
export function oauthGetJson(body: object, status = 200, extraHeaders: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...GET_HEADERS, ...extraHeaders } })
}

export function oauthGetPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: GET_HEADERS })
}
