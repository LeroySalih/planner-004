import type { NextRequest } from "next/server"

import { addRedirectUri, clientJson, removeRedirectUri } from "@/lib/oauth/client-store"
import { json, readBody, RedirectUriBody, withProjectKey, type RouteContext } from "../../handler"

// One exact redirect URI at a time. The last one can never be removed: add
// the replacement first.

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  return withProjectKey(request, "client.redirect_uri.add", id, async (db, actor) => {
    const { uri } = await readBody(request, RedirectUriBody)
    return json({ client: clientJson(await addRedirectUri(db, actor, id, uri)) })
  })
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  return withProjectKey(request, "client.redirect_uri.remove", id, async (db, actor) => {
    const { uri } = await readBody(request, RedirectUriBody)
    return json({ client: clientJson(await removeRedirectUri(db, actor, id, uri)) })
  })
}
