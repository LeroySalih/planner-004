import * as dotenv from "dotenv"
// Dev keeps env in .env; the production build uses .env.build. Load both — dotenv
// does not override already-set vars, so whichever is present populates the env.
dotenv.config()
dotenv.config({ path: ".env.build" })
import { Pool } from "pg"

import { ClientValidationError } from "@/lib/oauth/clients"
import {
  ClientRequestError,
  createFirstPartyClient,
  getFirstPartyClient,
  updateFirstPartyClient,
  type AuditActor,
} from "@/lib/oauth/client-store"

// Creates or updates a first-party OAuth client (docs/FIRST-PARTY-CLIENTS.md),
// with the same rules as the admin UI and the project-key API
// (src/lib/oauth/clients.ts). Redirect URIs differ per environment, so
// clients are registered here rather than by migration.
//
// A sign-in client (Kerf):
//   npx tsx scripts/register-oauth-client.ts \
//     --id kerf-editor --name "Kerf Sabre Editor" \
//     --redirect-uri https://kerf.example.org/auth/callback \
//     --redirect-uri http://localhost:5173/auth/callback \
//     --roles pupil,teacher,admin,technician --scopes profile \
//     --audience kerf-sabre --access-ttl 900 --refresh-ttl 604800
//
// A service client (prints its secret once, on creation only):
//   npx tsx scripts/register-oauth-client.ts --type service \
//     --id kerf-sync --name "Kerf sync job" \
//     --audiences planner-api --service-scopes groups:read --access-ttl 300
//
// Every redirect URI is matched exactly, so list each origin you use. Running
// it again replaces the client's settings; its live connections are kept. It
// refuses to touch an MCP client. Rotate a service secret in the admin UI.

function fail(message: string): never {
  console.error(`register-oauth-client: ${message}`)
  process.exit(1)
}

function parseArgs(argv: string[]) {
  const values = new Map<string, string[]>()
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!flag.startsWith("--") || value === undefined || value.startsWith("--")) fail(`expected a value after ${flag}`)
    values.set(flag.slice(2), [...(values.get(flag.slice(2)) ?? []), value])
    i += 1
  }
  const one = (key: string) => values.get(key)?.at(-1)
  const list = (key: string) => (one(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean)
  const seconds = (key: string) => (one(key) === undefined ? undefined : Number(one(key)))
  const type = one("type") ?? "public"
  if (type !== "public" && type !== "service") fail("--type must be public or service")
  return {
    clientId: one("id") ?? fail("--id is required"),
    clientName: one("name") ?? fail("--name is required"),
    clientType: type as "public" | "service",
    redirectUris: values.get("redirect-uri") ?? [],
    allowedRoles: list("roles"),
    allowedScopes: list("scopes"),
    audience: one("audience") ?? null,
    allowedAudiences: list("audiences"),
    allowedServiceScopes: list("service-scopes"),
    accessTtlSeconds: seconds("access-ttl"),
    refreshTtlSeconds: seconds("refresh-ttl"),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = await pool.connect()
  const actor: AuditActor = { kind: "script" }
  try {
    const existing = await getFirstPartyClient(db, actor, args.clientId).catch((error) => {
      if (error instanceof ClientRequestError && error.status === 404) return null
      throw error
    })
    if (existing) {
      if (existing.clientType !== args.clientType) fail(`${args.clientId} is a ${existing.clientType} client; its type cannot change`)
      await updateFirstPartyClient(db, actor, args.clientId, args)
      console.log(`Updated ${args.clientId}`)
    } else {
      const { clientSecret } = await createFirstPartyClient(db, actor, args)
      console.log(`Registered ${args.clientId}`)
      if (clientSecret) {
        console.log(`client_secret (shown once, store it in the service's .env): ${clientSecret}`)
      }
    }
  } catch (error) {
    if (error instanceof ClientRequestError && error.status === 409) fail(`${args.clientId} is already an MCP client and cannot be made first-party`)
    if (error instanceof ClientRequestError || error instanceof ClientValidationError) fail(error.message)
    throw error
  } finally {
    db.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
