import type { NextRequest } from "next/server"

import { clientJson, createFirstPartyClient, listFirstPartyClients } from "@/lib/oauth/client-store"
import { CreateClientBody, json, readBody, withProjectKey } from "./handler"

// A project's own first-party OAuth clients (docs/FIRST-PARTY-CLIENTS.md).

export async function GET(request: NextRequest): Promise<Response> {
  return withProjectKey(request, "client.list", null, async (db, actor) => {
    const clients = await listFirstPartyClients(db, actor)
    return json({ clients: clients.map(clientJson) })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return withProjectKey(request, "client.create", null, async (db, actor) => {
    const body = await readBody(request, CreateClientBody)
    const { client, clientSecret } = await createFirstPartyClient(db, actor, {
      clientId: body.client_id,
      clientName: body.client_name,
      clientType: body.client_type,
      redirectUris: body.redirect_uris,
      allowedRoles: body.roles,
      allowedScopes: body.scopes,
      audience: body.audience,
      allowedAudiences: body.allowed_audiences,
      allowedServiceScopes: body.service_scopes,
      accessTtlSeconds: body.access_ttl_seconds,
      refreshTtlSeconds: body.refresh_ttl_seconds,
    })
    // A service client's secret is shown here once and never again.
    return json({ client: clientJson(client), ...(clientSecret ? { client_secret: clientSecret } : {}) }, 201)
  })
}
