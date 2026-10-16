import type { NextRequest } from "next/server"

import { clientJson, rotateClientSecret } from "@/lib/oauth/client-store"
import { json, readBody, RotateSecretBody, withProjectKey, type RouteContext } from "../../handler"

// A new secret for a service client, shown once. With overlap_seconds the
// old secret keeps working that long, so the service can be redeployed first.
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  return withProjectKey(request, "client.rotate_secret", id, async (db, actor) => {
    const { overlap_seconds } = await readBody(request, RotateSecretBody, true)
    const { client, clientSecret } = await rotateClientSecret(db, actor, id, overlap_seconds ?? 0)
    return json({ client: clientJson(client), client_secret: clientSecret })
  })
}
