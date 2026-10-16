import { publicJwks } from "@/lib/oauth/jwt"
import { oauthGetJson, oauthGetPreflight } from "../cors"

// The public keys that first-party JWT access tokens are signed with: the
// current one, plus the previous one during a rotation (docs/KERF-SSO.md).
// Cached for 5 minutes; a verifier re-fetches on an unknown kid.
export async function GET(): Promise<Response> {
  try {
    return oauthGetJson(await publicJwks(), 200, { "Cache-Control": "public, max-age=300" })
  } catch (error) {
    console.error("[oauth] JWKS unavailable", error)
    return oauthGetJson({ error: "server_error", error_description: "Signing keys are not configured." }, 500)
  }
}

export function OPTIONS(): Response {
  return oauthGetPreflight()
}
