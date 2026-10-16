import type { NextRequest } from "next/server"

import { readUserinfo } from "@/lib/oauth/server"
import { publicOrigin } from "@/lib/public-origin"
import { oauthGetJson, oauthGetPreflight } from "../cors"

const INVALID_TOKEN = { "WWW-Authenticate": 'Bearer error="invalid_token"' }

// Who a first-party access JWT belongs to, read live: sub and roles, plus a
// display name (and a staff email) with the `profile` scope. Kerf must not
// store the name or email.
export async function GET(request: NextRequest): Promise<Response> {
  const header = request.headers.get("authorization")?.trim() ?? ""
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : ""
  const info = token ? await readUserinfo(token, publicOrigin(request.headers)) : null
  if (!info) {
    return oauthGetJson({ error: "invalid_token", error_description: "The access token is invalid or expired." }, 401, INVALID_TOKEN)
  }
  return oauthGetJson(info)
}

export function OPTIONS(): Response {
  return oauthGetPreflight()
}
