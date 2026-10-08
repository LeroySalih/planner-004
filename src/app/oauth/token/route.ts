import type { NextRequest } from "next/server"

import { exchangeAuthorizationCode, OAuthError, refreshAccessToken } from "@/lib/oauth/server"
import { oauthError, oauthJson, oauthPreflight } from "../cors"

// RFC 7636 §4.1: 43–128 unreserved characters.
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

// Token endpoint (RFC 6749 §3.2). Public clients only: PKCE stands in for a
// client secret.
export async function POST(request: NextRequest): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "Body must be application/x-www-form-urlencoded.")
  }
  const form = new URLSearchParams(await request.text())

  const field = (name: string) => form.get(name) || null
  const grantType = field("grant_type")

  try {
    if (grantType === "authorization_code") {
      const code = field("code")
      const clientId = field("client_id")
      const redirectUri = field("redirect_uri")
      const codeVerifier = field("code_verifier")
      if (!code || !clientId || !redirectUri || !codeVerifier) {
        return oauthError("invalid_request", "code, client_id, redirect_uri and code_verifier are required.")
      }
      if (!CODE_VERIFIER.test(codeVerifier)) {
        return oauthError("invalid_request", "code_verifier is malformed.")
      }
      return oauthJson(await exchangeAuthorizationCode({ code, clientId, redirectUri, codeVerifier }))
    }

    if (grantType === "refresh_token") {
      const refreshToken = field("refresh_token")
      const clientId = field("client_id")
      if (!refreshToken || !clientId) {
        return oauthError("invalid_request", "refresh_token and client_id are required.")
      }
      return oauthJson(await refreshAccessToken({ refreshToken, clientId }))
    }

    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.")
  } catch (error) {
    if (error instanceof OAuthError) return oauthError(error.code, error.message, error.status)
    console.error("[oauth] Token request failed", error)
    return oauthError("server_error", "Token request failed.", 500)
  }
}

export function OPTIONS(): Response {
  return oauthPreflight()
}
