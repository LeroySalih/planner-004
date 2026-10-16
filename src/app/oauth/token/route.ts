import type { NextRequest } from "next/server"

import { exchangeAuthorizationCode, issueServiceToken, OAuthError, refreshAccessToken } from "@/lib/oauth/server"
import { publicOrigin } from "@/lib/public-origin"
import { oauthError, oauthJson, oauthPreflight } from "../cors"

// RFC 7636 §4.1: 43–128 unreserved characters.
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

// The client_id and secret from HTTP Basic (RFC 6749 §2.3.1: each part is
// form-urlencoded before base64), or null if the header is absent or not Basic.
function basicCredentials(header: string | null): { clientId: string; clientSecret: string } | "malformed" | null {
  if (!header || !/^basic /i.test(header.trim())) return null
  try {
    const decoded = Buffer.from(header.trim().slice(6).trim(), "base64").toString("utf8")
    const colon = decoded.indexOf(":")
    if (colon < 1) return "malformed"
    const part = (value: string) => decodeURIComponent(value.replace(/\+/g, " "))
    return { clientId: part(decoded.slice(0, colon)), clientSecret: part(decoded.slice(colon + 1)) }
  } catch {
    return "malformed"
  }
}

const INVALID_CLIENT_BASIC = { "WWW-Authenticate": 'Basic realm="dino", charset="UTF-8"' }

// Token endpoint (RFC 6749 §3.2). Sign-in clients are public: PKCE stands in
// for a client secret. Service clients authenticate with their secret
// (client_secret_basic or client_secret_post) for client_credentials only.
export async function POST(request: NextRequest): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "Body must be application/x-www-form-urlencoded.")
  }
  const form = new URLSearchParams(await request.text())

  const field = (name: string) => form.get(name) || null
  const grantType = field("grant_type")
  // The `iss` of a JWT access token (APP_ORIGIN in production).
  const issuer = publicOrigin(request.headers)

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
      return oauthJson(await exchangeAuthorizationCode({ code, clientId, redirectUri, codeVerifier, issuer }))
    }

    if (grantType === "refresh_token") {
      const refreshToken = field("refresh_token")
      const clientId = field("client_id")
      if (!refreshToken || !clientId) {
        return oauthError("invalid_request", "refresh_token and client_id are required.")
      }
      return oauthJson(await refreshAccessToken({ refreshToken, clientId, issuer }))
    }

    if (grantType === "client_credentials") {
      const basic = basicCredentials(request.headers.get("authorization"))
      const postId = field("client_id")
      const postSecret = field("client_secret")
      if (basic === "malformed") {
        return oauthJson({ error: "invalid_client", error_description: "Client authentication failed." }, 401, INVALID_CLIENT_BASIC)
      }
      if (basic && postSecret) {
        return oauthError("invalid_request", "Authenticate with HTTP Basic or client_secret in the body, not both.")
      }
      if (basic && postId && postId !== basic.clientId) {
        return oauthError("invalid_request", "client_id does not match the Authorization header.")
      }
      const credentials = basic ?? (postId && postSecret ? { clientId: postId, clientSecret: postSecret } : null)
      if (!credentials) {
        return oauthJson({ error: "invalid_client", error_description: "Client authentication is required." }, 401, INVALID_CLIENT_BASIC)
      }
      try {
        return oauthJson(
          await issueServiceToken({
            ...credentials,
            audience: field("audience") ?? field("resource"),
            scope: field("scope"),
            issuer,
          }),
        )
      } catch (error) {
        if (error instanceof OAuthError && error.code === "invalid_client" && basic) {
          return oauthJson({ error: error.code, error_description: error.message }, 401, INVALID_CLIENT_BASIC)
        }
        throw error
      }
    }

    return oauthError("unsupported_grant_type", "Use authorization_code, refresh_token or client_credentials.")
  } catch (error) {
    if (error instanceof OAuthError) return oauthError(error.code, error.message, error.status)
    // Never the request body or headers: they carry codes, tokens and secrets.
    console.error("[oauth] Token request failed", { grantType, clientId: field("client_id"), error })
    return oauthError("server_error", "Token request failed.", 500)
  }
}

export function OPTIONS(): Response {
  return oauthPreflight()
}
