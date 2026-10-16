import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import type { Queryable } from "@/lib/curriculum/unit-curriculum-guard"
import type { ApiKey } from "@/lib/oauth/api-keys"
import {
  ClientValidationError,
  MAX_REDIRECT_URIS,
  validateClientSettings,
  type ClientCeiling,
  type ClientInput,
  type ClientSettings,
} from "@/lib/oauth/clients"

// Creating and changing first-party OAuth clients (docs/FIRST-PARTY-CLIENTS.md)
// for all three surfaces: the admin UI, the scripts and the project-key API.
// The actor decides the rules:
//   - a project key sees only the clients it owns (anything else is "not
//     found") and is held to its ceiling;
//   - an admin or a script sees every first-party client, with no ceiling.
// Nobody here can see or touch an MCP (dynamically registered) client.
//
// Every change, and every refusal, is written to oauth_client_audit_log.

export type AuditActor = { kind: "api_key"; key: ApiKey } | { kind: "admin"; userId: string } | { kind: "script" }

/** An HTTP-shaped refusal: 404 not yours, 409 taken, 403 ceiling, 422 invalid. */
export class ClientRequestError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message)
  }
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url")

/** Constant-time equality of two base64url SHA-256 digests. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export const SERVICE_SECRET_PREFIX = "dino_cs_"
const MAX_SECRET_OVERLAP_S = 7 * 24 * 60 * 60

export type FirstPartyClient = ClientSettings & {
  ownerKeyId: string | null
  disabledAt: string | null
  pendingApproval: boolean
  /** An admin disabled it, so only an admin can enable it. */
  disabledByAdmin: boolean
  createdAt: string
  /** Service clients only: the previous secret still works until then. */
  previousSecretExpiresAt: string | null
}

type ClientRow = {
  client_id: string
  client_name: string
  client_type: "public" | "service"
  redirect_uris: string[]
  allowed_roles: string[] | null
  allowed_scopes: string[]
  audience: string | null
  allowed_audiences: string[]
  allowed_service_scopes: string[]
  access_ttl_seconds: number | null
  refresh_ttl_seconds: number | null
  owner_key_id: string | null
  disabled_at: Date | null
  pending_approval: boolean
  disabled_by_admin: boolean
  created_at: Date
  previous_secret_expires_at: Date | null
}

const CLIENT_COLUMNS = `client_id, client_name, client_type, redirect_uris, allowed_roles, allowed_scopes,
  audience, allowed_audiences, allowed_service_scopes, access_ttl_seconds, refresh_ttl_seconds,
  owner_key_id, disabled_at, pending_approval, disabled_by_admin, created_at, previous_secret_expires_at`

function toClient(row: ClientRow): FirstPartyClient {
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    clientType: row.client_type,
    redirectUris: row.redirect_uris,
    allowedRoles: row.allowed_roles ?? [],
    allowedScopes: row.allowed_scopes,
    audience: row.audience,
    allowedAudiences: row.allowed_audiences,
    allowedServiceScopes: row.allowed_service_scopes,
    accessTtlSeconds: row.access_ttl_seconds ?? 0,
    refreshTtlSeconds: row.refresh_ttl_seconds,
    ownerKeyId: row.owner_key_id,
    disabledAt: row.disabled_at?.toISOString() ?? null,
    pendingApproval: row.pending_approval,
    disabledByAdmin: row.disabled_by_admin,
    createdAt: row.created_at.toISOString(),
    previousSecretExpiresAt:
      row.previous_secret_expires_at && row.previous_secret_expires_at > new Date()
        ? row.previous_secret_expires_at.toISOString()
        : null,
  }
}

/** The API's JSON shape for a client. Never a secret or a hash. */
export function clientJson(client: FirstPartyClient) {
  return {
    client_id: client.clientId,
    client_name: client.clientName,
    client_type: client.clientType,
    redirect_uris: client.redirectUris,
    roles: client.allowedRoles,
    scopes: client.allowedScopes,
    audience: client.audience,
    allowed_audiences: client.allowedAudiences,
    service_scopes: client.allowedServiceScopes,
    access_ttl_seconds: client.accessTtlSeconds,
    refresh_ttl_seconds: client.refreshTtlSeconds,
    status: client.pendingApproval ? "pending_approval" : client.disabledAt ? "disabled" : "enabled",
    created_at: client.createdAt,
    previous_secret_expires_at: client.previousSecretExpiresAt,
  }
}

/** What the audit log keeps about a client: settings and status, never secrets. */
function snapshot(client: FirstPartyClient) {
  const json: Partial<ReturnType<typeof clientJson>> = clientJson(client)
  delete json.client_id
  delete json.created_at
  delete json.previous_secret_expires_at
  return json
}

const ceilingOf = (actor: AuditActor): ClientCeiling | null => (actor.kind === "api_key" ? actor.key : null)
const ownerOf = (actor: AuditActor): string | null => (actor.kind === "api_key" ? actor.key.id : null)

type AuditEntry = {
  action: string
  clientId?: string | null
  apiKey?: ApiKey | null
  before?: object | null
  after?: object | null
  outcome: "ok" | "refused" | "error"
  status?: number | null
  error?: string | null
}

/** Never throws: losing an audit line must not fail the request it describes. */
export async function recordAudit(db: Queryable, actor: AuditActor, entry: AuditEntry): Promise<void> {
  const apiKey = actor.kind === "api_key" ? actor.key : entry.apiKey ?? null
  try {
    await db.query(
      `insert into oauth_client_audit_log
         (actor, api_key_id, key_name, key_prefix, user_id, client_id, action, before, after, outcome, status, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        actor.kind,
        apiKey?.id ?? null,
        apiKey?.name ?? null,
        apiKey?.keyPrefix ?? null,
        actor.kind === "admin" ? actor.userId : null,
        entry.clientId ?? null,
        entry.action,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.after ? JSON.stringify(entry.after) : null,
        entry.outcome,
        entry.status ?? null,
        entry.error?.slice(0, 500) ?? null,
      ],
    )
  } catch (error) {
    console.error("[oauth] audit write failed", { action: entry.action, clientId: entry.clientId, error })
  }
}

/** Errors audited() has already logged, so a caller does not log them twice. */
export const auditedErrors = new WeakSet<object>()

type ActionResult<T> = { result: T; before?: FirstPartyClient | null; after?: FirstPartyClient | null }

/**
 * Runs one change and audits it: ok with before/after, or the refusal with
 * its status. Unexpected errors are audited as `error` and rethrown.
 */
async function audited<T>(
  db: Queryable,
  actor: AuditActor,
  action: string,
  clientId: string | null,
  fn: () => Promise<ActionResult<T>>,
): Promise<T> {
  try {
    const { result, before, after } = await fn()
    await recordAudit(db, actor, {
      action,
      clientId: after?.clientId ?? before?.clientId ?? clientId,
      before: before ? snapshot(before) : null,
      after: after ? snapshot(after) : null,
      outcome: "ok",
    })
    return result
  } catch (error) {
    const refused = error instanceof ClientRequestError || error instanceof ClientValidationError
    await recordAudit(db, actor, {
      action,
      clientId,
      outcome: refused ? "refused" : "error",
      status: refused ? error.status : 500,
      error: refused ? error.message : "internal error",
    })
    if (error instanceof Error) auditedErrors.add(error)
    throw error
  }
}

/** Every first-party client this actor may see: a key's own, or all for an admin. */
export async function listFirstPartyClients(db: Queryable, actor: AuditActor): Promise<FirstPartyClient[]> {
  const owner = ownerOf(actor)
  const { rows } = await db.query<ClientRow>(
    `select ${CLIENT_COLUMNS} from oauth_clients
     where first_party and ($1::uuid is null or owner_key_id = $1)
     order by client_id`,
    [owner],
  )
  return rows.map(toClient)
}

async function loadOwned(db: Queryable, actor: AuditActor, clientId: string, forUpdate = false): Promise<FirstPartyClient> {
  const { rows } = await db.query<ClientRow>(
    `select ${CLIENT_COLUMNS} from oauth_clients
     where client_id = $1 and first_party and ($2::uuid is null or owner_key_id = $2)
     ${forUpdate ? "for update" : ""}`,
    [clientId, ownerOf(actor)],
  )
  // Another project's client, an MCP client and no client all look the same.
  if (!rows[0]) throw new ClientRequestError(404, `No client ${clientId}.`)
  return toClient(rows[0])
}

export async function getFirstPartyClient(db: Queryable, actor: AuditActor, clientId: string): Promise<FirstPartyClient> {
  return loadOwned(db, actor, clientId)
}

async function inTransaction<T>(db: Queryable, fn: () => Promise<T>): Promise<T> {
  await db.query("begin")
  try {
    const result = await fn()
    await db.query("commit")
    return result
  } catch (error) {
    await db.query("rollback")
    throw error
  }
}

/**
 * A sign-in audience and a service audience are never the same string, so a
 * service token can never be mistaken for a user token by a resource server
 * that checks only `aud`. Applies to admins and scripts too.
 */
async function assertAudiencesSeparate(db: Queryable, settings: ClientSettings) {
  if (settings.clientType === "service") {
    const { rows } = await db.query<{ audience: string }>(
      `select distinct audience from oauth_clients
       where client_type = 'public' and audience = any($1) and client_id <> $2`,
      [settings.allowedAudiences, settings.clientId],
    )
    if (rows[0]) {
      throw new ClientRequestError(422, `${rows[0].audience} is a sign-in audience; give the service its own audience.`)
    }
  } else if (settings.audience) {
    const { rows } = await db.query<{ client_id: string }>(
      `select client_id from oauth_clients
       where client_type = 'service' and $1 = any(allowed_audiences) and client_id <> $2 limit 1`,
      [settings.audience, settings.clientId],
    )
    if (rows[0]) {
      throw new ClientRequestError(422, `${settings.audience} is a service audience; give the sign-in client its own audience.`)
    }
  }
}

const newServiceSecret = () => `${SERVICE_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`

/**
 * Creates a client. A service client's secret is returned here once and
 * never again. A key that requires approval creates it disabled, pending an
 * admin. `db` must be a single connection (it runs a transaction).
 */
export async function createFirstPartyClient(
  db: Queryable,
  actor: AuditActor,
  input: ClientInput,
): Promise<{ client: FirstPartyClient; clientSecret: string | null }> {
  return audited(db, actor, "client.create", typeof input.clientId === "string" ? input.clientId : null, async () => {
    const settings = validateClientSettings(input, ceilingOf(actor))
    const clientSecret = settings.clientType === "service" ? newServiceSecret() : null
    const pending = actor.kind === "api_key" && actor.key.requiresApproval

    const client = await inTransaction(db, async () => {
      if (actor.kind === "api_key") {
        // Serialises creates per key, so two at once cannot both slip under max_clients.
        const { rows } = await db.query<{ owned: number }>(
          `select (select count(*)::int from oauth_clients where owner_key_id = k.id) as owned
           from oauth_api_keys k where k.id = $1 for update`,
          [actor.key.id],
        )
        if ((rows[0]?.owned ?? 0) >= actor.key.maxClients) {
          throw new ClientRequestError(403, `This project may have at most ${actor.key.maxClients} clients.`)
        }
      }
      await assertAudiencesSeparate(db, settings)
      const { rows } = await db.query<ClientRow>(
        `insert into oauth_clients
           (client_id, client_name, client_type, redirect_uris, first_party, token_format, allowed_roles,
            allowed_scopes, audience, allowed_audiences, allowed_service_scopes, access_ttl_seconds,
            refresh_ttl_seconds, client_secret_hash, owner_key_id, disabled_at, pending_approval)
         values ($1, $2, $3, $4, true, 'jwt', $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 case when $14 then now() end, $14)
         on conflict (client_id) do nothing
         returning ${CLIENT_COLUMNS}`,
        [
          settings.clientId,
          settings.clientName,
          settings.clientType,
          settings.redirectUris,
          settings.clientType === "public" ? settings.allowedRoles : null,
          settings.allowedScopes,
          settings.audience,
          settings.allowedAudiences,
          settings.allowedServiceScopes,
          settings.accessTtlSeconds,
          settings.refreshTtlSeconds,
          clientSecret ? sha256(clientSecret) : null,
          ownerOf(actor),
          pending,
        ],
      )
      if (!rows[0]) throw new ClientRequestError(409, `client_id ${settings.clientId} is already taken.`)
      return toClient(rows[0])
    })
    return { result: { client, clientSecret }, after: client }
  })
}

export type ClientPatch = Partial<
  Pick<
    ClientInput,
    "clientName" | "redirectUris" | "allowedRoles" | "allowedScopes" | "audience" | "allowedAudiences" | "allowedServiceScopes" | "accessTtlSeconds" | "refreshTtlSeconds"
  >
>

/** Applies a change and re-checks the whole result, ceiling included. */
async function writeSettings(db: Queryable, actor: AuditActor, before: FirstPartyClient, patch: ClientPatch) {
  const settings = validateClientSettings(
    {
      clientId: before.clientId,
      clientType: before.clientType,
      clientName: patch.clientName ?? before.clientName,
      redirectUris: patch.redirectUris ?? before.redirectUris,
      allowedRoles: patch.allowedRoles ?? before.allowedRoles,
      allowedScopes: patch.allowedScopes ?? before.allowedScopes,
      audience: patch.audience !== undefined ? patch.audience : before.audience,
      allowedAudiences: patch.allowedAudiences ?? before.allowedAudiences,
      allowedServiceScopes: patch.allowedServiceScopes ?? before.allowedServiceScopes,
      accessTtlSeconds: patch.accessTtlSeconds ?? before.accessTtlSeconds,
      refreshTtlSeconds: patch.refreshTtlSeconds !== undefined ? patch.refreshTtlSeconds : before.refreshTtlSeconds,
    },
    ceilingOf(actor),
  )
  await assertAudiencesSeparate(db, settings)
  const { rows } = await db.query<ClientRow>(
    `update oauth_clients
     set client_name = $2, redirect_uris = $3, allowed_roles = $4, allowed_scopes = $5, audience = $6,
         allowed_audiences = $7, allowed_service_scopes = $8, access_ttl_seconds = $9, refresh_ttl_seconds = $10
     where client_id = $1
     returning ${CLIENT_COLUMNS}`,
    [
      before.clientId,
      settings.clientName,
      settings.redirectUris,
      settings.clientType === "public" ? settings.allowedRoles : null,
      settings.allowedScopes,
      settings.audience,
      settings.allowedAudiences,
      settings.allowedServiceScopes,
      settings.accessTtlSeconds,
      settings.refreshTtlSeconds,
    ],
  )
  return toClient(rows[0])
}

export async function updateFirstPartyClient(
  db: Queryable,
  actor: AuditActor,
  clientId: string,
  patch: ClientPatch,
): Promise<FirstPartyClient> {
  return audited(db, actor, "client.update", clientId, async () => {
    const after = await inTransaction(db, async () => {
      const before = await loadOwned(db, actor, clientId, true)
      return { before, after: await writeSettings(db, actor, before, patch) }
    })
    return { result: after.after, ...after }
  })
}

export async function addRedirectUri(db: Queryable, actor: AuditActor, clientId: string, uri: string): Promise<FirstPartyClient> {
  return audited(db, actor, "client.redirect_uri.add", clientId, async () => {
    const changed = await inTransaction(db, async () => {
      const before = await loadOwned(db, actor, clientId, true)
      if (before.clientType === "service") throw new ClientRequestError(422, "A service client has no redirect URIs.")
      if (before.redirectUris.includes(uri)) throw new ClientRequestError(422, "That redirect URI is already registered.")
      if (before.redirectUris.length >= MAX_REDIRECT_URIS) {
        throw new ClientRequestError(422, `A client can have at most ${MAX_REDIRECT_URIS} redirect URIs.`)
      }
      return { before, after: await writeSettings(db, actor, before, { redirectUris: [...before.redirectUris, uri] }) }
    })
    return { result: changed.after, ...changed }
  })
}

export async function removeRedirectUri(db: Queryable, actor: AuditActor, clientId: string, uri: string): Promise<FirstPartyClient> {
  return audited(db, actor, "client.redirect_uri.remove", clientId, async () => {
    const changed = await inTransaction(db, async () => {
      const before = await loadOwned(db, actor, clientId, true)
      if (!before.redirectUris.includes(uri)) throw new ClientRequestError(422, "That redirect URI is not registered.")
      if (before.redirectUris.length === 1) {
        throw new ClientRequestError(422, "A client must keep at least one redirect URI. Add the new one first.")
      }
      return {
        before,
        after: await writeSettings(db, actor, before, { redirectUris: before.redirectUris.filter((value) => value !== uri) }),
      }
    })
    return { result: changed.after, ...changed }
  })
}

/**
 * Disables or enables a client. A project can enable its own client only once
 * an admin has approved it, and never one an admin disabled; an admin
 * enabling a pending client approves it.
 * Disabling stops sign-in, refresh and service tokens at once; JWTs already
 * issued run to their expiry.
 */
export async function setClientEnabled(
  db: Queryable,
  actor: AuditActor,
  clientId: string,
  enabled: boolean,
): Promise<FirstPartyClient> {
  return audited(db, actor, enabled ? "client.enable" : "client.disable", clientId, async () => {
    const changed = await inTransaction(db, async () => {
      const before = await loadOwned(db, actor, clientId, true)
      if (enabled && actor.kind === "api_key") {
        if (before.pendingApproval) throw new ClientRequestError(403, "This client is waiting for an admin to approve it.")
        if (before.disabledByAdmin) throw new ClientRequestError(403, "An admin disabled this client. Ask an admin to enable it.")
      }
      const { rows } = await db.query<ClientRow>(
        `update oauth_clients
         set disabled_at = case when $2 then null else coalesce(disabled_at, now()) end,
             pending_approval = case when $2 then false else pending_approval end,
             disabled_by_admin = case when $2 then false when $3 then true else disabled_by_admin end
         where client_id = $1
         returning ${CLIENT_COLUMNS}`,
        [clientId, enabled, actor.kind !== "api_key"],
      )
      return { before, after: toClient(rows[0]) }
    })
    return { result: changed.after, ...changed }
  })
}

/**
 * A new secret for a service client, returned once. The old one keeps working
 * for `overlapSeconds` (default 0: it stops at once).
 */
export async function rotateClientSecret(
  db: Queryable,
  actor: AuditActor,
  clientId: string,
  overlapSeconds = 0,
): Promise<{ client: FirstPartyClient; clientSecret: string }> {
  return audited(db, actor, "client.rotate_secret", clientId, async () => {
    if (!Number.isInteger(overlapSeconds) || overlapSeconds < 0 || overlapSeconds > MAX_SECRET_OVERLAP_S) {
      throw new ClientRequestError(422, `overlap_seconds must be 0 to ${MAX_SECRET_OVERLAP_S}.`)
    }
    const clientSecret = newServiceSecret()
    const changed = await inTransaction(db, async () => {
      const before = await loadOwned(db, actor, clientId, true)
      if (before.clientType !== "service") {
        throw new ClientRequestError(422, "Only a service client has a secret. Sign-in clients use PKCE.")
      }
      const { rows } = await db.query<ClientRow>(
        `update oauth_clients
         set previous_client_secret_hash = case when $3 > 0 then client_secret_hash end,
             previous_secret_expires_at = case when $3 > 0 then now() + make_interval(secs => $3) end,
             client_secret_hash = $2
         where client_id = $1
         returning ${CLIENT_COLUMNS}`,
        [clientId, sha256(clientSecret), overlapSeconds],
      )
      return { before, after: toClient(rows[0]) }
    })
    return {
      result: { client: changed.after, clientSecret },
      before: changed.before,
      after: changed.after,
    }
  })
}
