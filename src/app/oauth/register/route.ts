import type { NextRequest } from "next/server"

import { OAuthError, registerClient } from "@/lib/oauth/server"
import { OAuthClientRegistrationSchema } from "@/types"
import { oauthError, oauthJson, oauthPreflight } from "../cors"

const MAX_BODY_BYTES = 16 * 1024

// Dynamic Client Registration (RFC 7591). Open by design — Claude registers
// itself before the teacher has signed in — so what keeps it safe is the
// redirect URI allowlist: a code can only ever be delivered to Claude.
export async function POST(request: NextRequest): Promise<Response> {
  // Refuse on the declared length before buffering anything, then again on
  // what actually arrived, since the header can be absent or wrong.
  const declared = Number(request.headers.get("content-length") ?? "0")
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) {
    return oauthError("invalid_client_metadata", "Registration request is too large.", 413)
  }
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) {
    return oauthError("invalid_client_metadata", "Registration request is too large.", 413)
  }

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON.")
  }

  const parsed = OAuthClientRegistrationSchema.safeParse(body)
  if (!parsed.success) {
    return oauthError("invalid_client_metadata", parsed.error.issues.map((issue) => issue.message).join("; "))
  }

  try {
    return oauthJson(await registerClient(parsed.data), 201)
  } catch (error) {
    if (error instanceof OAuthError) return oauthError(error.code, error.message, error.status)
    console.error("[oauth] Client registration failed", error)
    return oauthError("server_error", "Registration failed.", 500)
  }
}

export function OPTIONS(): Response {
  return oauthPreflight()
}
