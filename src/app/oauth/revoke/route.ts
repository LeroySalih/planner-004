import type { NextRequest } from "next/server"

import { revokeToken } from "@/lib/oauth/server"
import { oauthError, oauthJson, oauthPreflight } from "../cors"

// Token revocation (RFC 7009), used by Kerf's "Sign out". Takes a refresh
// token or an access JWT and ends the connection it belongs to. Public
// clients, so client_id is the only identification. Always 200, whether or
// not the token existed (§2.2), so it reveals nothing about tokens.
export async function POST(request: NextRequest): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "Body must be application/x-www-form-urlencoded.")
  }
  const form = new URLSearchParams(await request.text())
  const token = form.get("token")
  const clientId = form.get("client_id")
  if (!token || !clientId) {
    return oauthError("invalid_request", "token and client_id are required.")
  }

  try {
    await revokeToken({ token, clientId })
  } catch (error) {
    console.error("[oauth] Revocation failed", { clientId, error })
    return oauthError("server_error", "Revocation failed.", 500)
  }
  return oauthJson({})
}

export function OPTIONS(): Response {
  return oauthPreflight()
}
