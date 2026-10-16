import type { NextRequest } from "next/server"

import { clientJson, setClientEnabled } from "@/lib/oauth/client-store"
import { json, withProjectKey, type RouteContext } from "../../handler"

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  return withProjectKey(request, "client.enable", id, async (db, actor) =>
    json({ client: clientJson(await setClientEnabled(db, actor, id, true)) }),
  )
}
