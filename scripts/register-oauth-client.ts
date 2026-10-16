import * as dotenv from "dotenv"
// Dev keeps env in .env; the production build uses .env.build. Load both — dotenv
// does not override already-set vars, so whichever is present populates the env.
dotenv.config()
dotenv.config({ path: ".env.build" })
import { Pool } from "pg"

// Upserts a first-party OAuth client (docs/KERF-SSO.md). Redirect URIs differ
// per environment, so clients are registered here rather than by migration.
//
//   npx tsx scripts/register-oauth-client.ts \
//     --id kerf-editor --name "Kerf Sabre Editor" \
//     --redirect-uri https://kerf.example.org/auth/callback \
//     --redirect-uri http://localhost:5173/auth/callback \
//     --roles pupil,teacher,admin,technician --scopes profile \
//     --audience kerf-sabre --access-ttl 900 --refresh-ttl 604800
//
// Every redirect URI is matched exactly, so list each origin you use. Running
// it again replaces the client's settings; its live connections are kept.

const ROLES = ["pupil", "teacher", "admin", "technician"]
const SCOPES = ["profile", "groups"]

type Args = {
  id: string
  name: string
  redirectUris: string[]
  roles: string[]
  scopes: string[]
  audience: string
  accessTtl: number
  refreshTtl: number
}

function fail(message: string): never {
  console.error(`register-oauth-client: ${message}`)
  process.exit(1)
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string[]>()
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!flag.startsWith("--") || value === undefined || value.startsWith("--")) fail(`expected a value after ${flag}`)
    values.set(flag.slice(2), [...(values.get(flag.slice(2)) ?? []), value])
    i += 1
  }
  const one = (key: string, fallback?: string) => values.get(key)?.at(-1) ?? fallback ?? fail(`--${key} is required`)
  const list = (key: string) => one(key).split(",").map((v) => v.trim()).filter(Boolean)
  const seconds = (key: string, fallback: string) => {
    const n = Number(one(key, fallback))
    if (!Number.isInteger(n) || n <= 0) fail(`--${key} must be a whole number of seconds`)
    return n
  }

  const args: Args = {
    id: one("id"),
    name: one("name"),
    redirectUris: values.get("redirect-uri") ?? fail("give at least one --redirect-uri"),
    roles: list("roles"),
    scopes: values.has("scopes") ? list("scopes") : [],
    audience: one("audience"),
    accessTtl: seconds("access-ttl", "900"),
    refreshTtl: seconds("refresh-ttl", "604800"),
  }

  if (!/^[A-Za-z0-9_-]{3,64}$/.test(args.id)) fail("--id may use letters, digits, _ and -, 3 to 64 characters")
  for (const uri of args.redirectUris) {
    let url: URL
    try {
      url = new URL(uri)
    } catch {
      fail(`not an absolute URL: ${uri}`)
    }
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1"
    if (url.hash || uri.includes("#")) fail(`redirect URIs cannot have a fragment: ${uri}`)
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      fail(`use https, or http only on localhost: ${uri}`)
    }
  }
  const badRole = args.roles.find((role) => !ROLES.includes(role))
  if (badRole || args.roles.length === 0) fail(`--roles must be some of ${ROLES.join(", ")}`)
  const badScope = args.scopes.find((scope) => !SCOPES.includes(scope))
  if (badScope) fail(`--scopes must be some of ${SCOPES.join(", ")}`)
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    // The WHERE refuses to turn an MCP client (dynamically registered) into a
    // first-party one.
    const { rows } = await pool.query<{ client_id: string; inserted: boolean }>(
      `insert into oauth_clients
         (client_id, client_name, redirect_uris, first_party, token_format, allowed_roles,
          audience, allowed_scopes, access_ttl_seconds, refresh_ttl_seconds)
       values ($1, $2, $3, true, 'jwt', $4, $5, $6, $7, $8)
       on conflict (client_id) do update set
         client_name = excluded.client_name,
         redirect_uris = excluded.redirect_uris,
         token_format = excluded.token_format,
         allowed_roles = excluded.allowed_roles,
         audience = excluded.audience,
         allowed_scopes = excluded.allowed_scopes,
         access_ttl_seconds = excluded.access_ttl_seconds,
         refresh_ttl_seconds = excluded.refresh_ttl_seconds
       where oauth_clients.first_party
       returning client_id, (xmax = 0) as inserted`,
      [args.id, args.name, args.redirectUris, args.roles, args.audience, args.scopes, args.accessTtl, args.refreshTtl],
    )
    if (!rows[0]) fail(`${args.id} is already an MCP client and cannot be made first-party`)
    console.log(`${rows[0].inserted ? "Registered" : "Updated"} ${args.id}: ${args.redirectUris.join(", ")}`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
