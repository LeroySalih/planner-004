import type { NextRequest } from "next/server"

import { readKerfGroups } from "@/lib/oauth/server"
import { publicOrigin } from "@/lib/public-origin"
import { oauthGetJson, oauthGetPreflight } from "../cors"

// The signed-in teacher's or admin's own classes, with their pupils' user ids
// only, for first-party clients (docs/KERF-SSO.md). Checked live like userinfo.
export async function GET(request: NextRequest): Promise<Response> {
  const header = request.headers.get("authorization")?.trim() ?? ""
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : ""
  const result = token ? await readKerfGroups(token, publicOrigin(request.headers)) : { status: "invalid_token" as const }

  switch (result.status) {
    case "ok":
      return oauthGetJson(result.groups)
    case "insufficient_scope":
      return oauthGetJson({ error: "insufficient_scope" }, 403, {
        "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="groups"',
      })
    case "forbidden":
      return oauthGetJson({ error: "forbidden" }, 403)
    default:
      return oauthGetJson(
        { error: "invalid_token", error_description: "The access token is invalid or expired." },
        401,
        { "WWW-Authenticate": 'Bearer error="invalid_token"' },
      )
  }
}

export function OPTIONS(): Response {
  return oauthGetPreflight()
}
