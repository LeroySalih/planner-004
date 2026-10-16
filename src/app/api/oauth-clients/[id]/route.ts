import type { NextRequest } from "next/server"

import { clientJson, getFirstPartyClient, updateFirstPartyClient } from "@/lib/oauth/client-store"
import { json, readBody, UpdateClientBody, withProjectKey, type RouteContext } from "../handler"

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  return withProjectKey(request, "client.read", id, async (db, actor) =>
    json({ client: clientJson(await getFirstPartyClient(db, actor, id)) }),
  )
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  return withProjectKey(request, "client.update", id, async (db, actor) => {
    const body = await readBody(request, UpdateClientBody)
    const client = await updateFirstPartyClient(db, actor, id, {
      clientName: body.client_name,
      allowedRoles: body.roles,
      allowedScopes: body.scopes,
      allowedAudiences: body.allowed_audiences,
      allowedServiceScopes: body.service_scopes,
      accessTtlSeconds: body.access_ttl_seconds ?? undefined,
      refreshTtlSeconds: body.refresh_ttl_seconds,
    })
    return json({ client: clientJson(client) })
  })
}
