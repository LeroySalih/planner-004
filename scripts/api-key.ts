import * as dotenv from "dotenv"
// Dev keeps env in .env; the production build uses .env.build. Load both — dotenv
// does not override already-set vars, so whichever is present populates the env.
dotenv.config()
dotenv.config({ path: ".env.build" })
import { Pool } from "pg"

import { createApiKey, displayKeyPrefix, listApiKeys, revokeApiKey, rotateApiKey } from "@/lib/oauth/api-keys"
import { ClientValidationError } from "@/lib/oauth/clients"
import type { AuditActor } from "@/lib/oauth/client-store"

// Project API keys for /api/oauth-clients (docs/FIRST-PARTY-CLIENTS.md).
// The key is printed once, by create and rotate, and never stored in clear.
//
//   npx tsx scripts/api-key.ts create --name kerf-sabre --prefix kerf- \
//     --roles pupil,teacher,technician --scopes profile,groups \
//     --hosts kerf.example.org,kerf-admin.example.org --audiences kerf-sabre \
//     [--max-clients 5] [--no-approval] [--expires 2027-07-31]
//   npx tsx scripts/api-key.ts list
//   npx tsx scripts/api-key.ts rotate kerf-sabre [--overlap 3600]
//   npx tsx scripts/api-key.ts revoke kerf-sabre
//
// 'admin' is never implied: list it in --roles to let the project's clients
// sign admins in.

function fail(message: string): never {
  console.error(`api-key: ${message}`)
  process.exit(1)
}

function flags(argv: string[]) {
  const values = new Map<string, string>()
  const positional: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--no-approval") {
      values.set("no-approval", "true")
    } else if (arg.startsWith("--")) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith("--")) fail(`expected a value after ${arg}`)
      values.set(arg.slice(2), value)
      i += 1
    } else {
      positional.push(arg)
    }
  }
  const list = (key: string) => (values.get(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean)
  return { values, positional, list }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { values, positional, list } = flags(rest)
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = await pool.connect()
  const actor: AuditActor = { kind: "script" }
  try {
    if (command === "create") {
      const expires = values.get("expires")
      const { key, apiKey } = await createApiKey(
        db,
        {
          name: values.get("name") ?? fail("--name is required"),
          clientIdPrefix: values.get("prefix") ?? fail("--prefix is required"),
          allowedRoles: list("roles"),
          allowedScopes: list("scopes"),
          allowedRedirectHosts: list("hosts"),
          allowedAudiences: list("audiences"),
          maxClients: values.has("max-clients") ? Number(values.get("max-clients")) : undefined,
          requiresApproval: !values.has("no-approval"),
          expiresAt: expires ? new Date(expires) : null,
        },
        actor,
      )
      console.log(`Created ${apiKey.name} (${displayKeyPrefix(apiKey.keyPrefix)})`)
      console.log(`API key (shown once, give it to the project's .env): ${key}`)
    } else if (command === "list") {
      for (const apiKey of await listApiKeys(db)) {
        const status = apiKey.revokedAt ? "revoked" : apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date() ? "expired" : "active"
        console.log(
          [
            apiKey.name.padEnd(20),
            displayKeyPrefix(apiKey.keyPrefix).padEnd(20),
            status.padEnd(8),
            `prefix=${apiKey.clientIdPrefix}`,
            `roles=${apiKey.allowedRoles.join(",")}`,
            `scopes=${apiKey.allowedScopes.join(",") || "-"}`,
            `hosts=${apiKey.allowedRedirectHosts.join(",") || "-"}`,
            `audiences=${apiKey.allowedAudiences.join(",") || "-"}`,
            `max=${apiKey.maxClients}`,
            apiKey.requiresApproval ? "approval" : "no-approval",
            `last_used=${apiKey.lastUsedAt ?? "never"}`,
          ].join("  "),
        )
      }
    } else if (command === "rotate") {
      const name = positional[0] ?? fail("rotate <name>")
      const { key, apiKey } = await rotateApiKey(db, name, Number(values.get("overlap") ?? 0), actor)
      console.log(`Rotated ${apiKey.name} (${displayKeyPrefix(apiKey.keyPrefix)})`)
      if (apiKey.previousExpiresAt) console.log(`The old key works until ${apiKey.previousExpiresAt}`)
      console.log(`API key (shown once): ${key}`)
    } else if (command === "revoke") {
      const apiKey = await revokeApiKey(db, positional[0] ?? fail("revoke <name>"), actor)
      console.log(`Revoked ${apiKey.name}. Its clients keep working; disable them in the admin UI if needed.`)
    } else {
      fail("use create, list, rotate or revoke")
    }
  } catch (error) {
    if (error instanceof ClientValidationError) fail(error.message)
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
