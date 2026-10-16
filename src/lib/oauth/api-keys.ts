import { randomBytes } from "node:crypto"

import type { Queryable } from "@/lib/curriculum/unit-curriculum-guard"
import { ClientValidationError, validateKeyPolicy, type KeyPolicyInput } from "@/lib/oauth/clients"
import { recordAudit, sameHash, sha256, type AuditActor } from "@/lib/oauth/client-store"

// Per-project API keys for /api/oauth-clients (docs/FIRST-PARTY-CLIENTS.md).
// Each project has its own key with its own ceiling, so a leak is revoked for
// that project alone. A key only manages its own clients: it never acts as a
// person, never opens /api/MCP and never changes keys.
//
// A key is `dino_pk_` + 32 random bytes (base64url). Like oauth_tokens, only
// its SHA-256 is stored: 256 random bits leave nothing to brute-force. The key
// is shown once, when it is created or rotated, and never logged.

export const API_KEY_PREFIX = "dino_pk_"
const API_KEY_PATTERN = /^dino_pk_[A-Za-z0-9_-]{43}$/
export const API_KEY_RATE_LIMIT_PER_MINUTE = 60
const MAX_ROTATION_OVERLAP_S = 7 * 24 * 60 * 60

export type ApiKey = {
  id: string
  name: string
  keyPrefix: string
  allowedRoles: string[]
  allowedScopes: string[]
  allowedRedirectHosts: string[]
  allowedAudiences: string[]
  maxClients: number
  clientIdPrefix: string
  requiresApproval: boolean
  createdBy: string | null
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  previousExpiresAt: string | null
}

type ApiKeyRow = {
  id: string
  name: string
  key_prefix: string
  key_hash: string
  previous_key_hash: string | null
  previous_expires_at: Date | null
  allowed_roles: string[]
  allowed_scopes: string[]
  allowed_redirect_hosts: string[]
  allowed_audiences: string[]
  max_clients: number
  client_id_prefix: string
  requires_approval: boolean
  created_by: string | null
  created_at: Date
  last_used_at: Date | null
  expires_at: Date | null
  revoked_at: Date | null
}

const KEY_COLUMNS = `id, name, key_prefix, key_hash, previous_key_hash, previous_expires_at, allowed_roles,
  allowed_scopes, allowed_redirect_hosts, allowed_audiences, max_clients, client_id_prefix,
  requires_approval, created_by, created_at, last_used_at, expires_at, revoked_at`

function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    allowedRoles: row.allowed_roles,
    allowedScopes: row.allowed_scopes,
    allowedRedirectHosts: row.allowed_redirect_hosts,
    allowedAudiences: row.allowed_audiences,
    maxClients: row.max_clients,
    clientIdPrefix: row.client_id_prefix,
    requiresApproval: row.requires_approval,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    previousExpiresAt:
      row.previous_key_hash && row.previous_expires_at && row.previous_expires_at > new Date()
        ? row.previous_expires_at.toISOString()
        : null,
  }
}

function newKey(): { key: string; prefix: string; hash: string } {
  const random = randomBytes(32).toString("base64url")
  const key = `${API_KEY_PREFIX}${random}`
  return { key, prefix: random.slice(0, 8), hash: sha256(key) }
}

/** How a key is shown in lists and logs: never more than its prefix. */
export const displayKeyPrefix = (prefix: string) => `${API_KEY_PREFIX}${prefix}…`

class KeyError extends ClientValidationError {}

export async function createApiKey(
  db: Queryable,
  input: KeyPolicyInput,
  actor: AuditActor,
): Promise<{ key: string; apiKey: ApiKey }> {
  const policy = validateKeyPolicy(input)
  const { key, prefix, hash } = newKey()
  const { rows } = await db.query<ApiKeyRow>(
    `insert into oauth_api_keys
       (name, key_prefix, key_hash, allowed_roles, allowed_scopes, allowed_redirect_hosts, allowed_audiences,
        max_clients, client_id_prefix, requires_approval, created_by, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (name) do nothing
     returning ${KEY_COLUMNS}`,
    [
      policy.name,
      prefix,
      hash,
      policy.allowedRoles,
      policy.allowedScopes,
      policy.allowedRedirectHosts,
      policy.allowedAudiences,
      policy.maxClients,
      policy.clientIdPrefix,
      policy.requiresApproval,
      actor.kind === "admin" ? actor.userId : null,
      policy.expiresAt?.toISOString() ?? null,
    ],
  )
  if (!rows[0]) throw new KeyError(422, `A key named ${policy.name} already exists.`)
  const apiKey = toApiKey(rows[0])
  await recordAudit(db, actor, { action: "key.create", apiKey, after: keySnapshot(apiKey), outcome: "ok" })
  return { key, apiKey }
}

export async function listApiKeys(db: Queryable): Promise<ApiKey[]> {
  const { rows } = await db.query<ApiKeyRow>(`select ${KEY_COLUMNS} from oauth_api_keys order by revoked_at nulls first, name`)
  return rows.map(toApiKey)
}

async function loadKey(db: Queryable, id: string): Promise<ApiKey> {
  const { rows } = await db.query<ApiKeyRow>(`select ${KEY_COLUMNS} from oauth_api_keys where id::text = $1 or name = $1`, [id])
  if (!rows[0]) throw new KeyError(422, "No such key.")
  return toApiKey(rows[0])
}

/** Stops the key (and any key it is rotating away from) at once. Its clients keep working. */
export async function revokeApiKey(db: Queryable, idOrName: string, actor: AuditActor): Promise<ApiKey> {
  const before = await loadKey(db, idOrName)
  const { rows } = await db.query<ApiKeyRow>(
    `update oauth_api_keys
     set revoked_at = coalesce(revoked_at, now()), previous_key_hash = null, previous_expires_at = null
     where id = $1 returning ${KEY_COLUMNS}`,
    [before.id],
  )
  const apiKey = toApiKey(rows[0])
  await recordAudit(db, actor, { action: "key.revoke", apiKey, before: keySnapshot(before), after: keySnapshot(apiKey), outcome: "ok" })
  return apiKey
}

/**
 * Issues a new key for the same project (same ceiling, same clients). The
 * old one keeps working for `overlapSeconds` (default 0: it stops at once).
 */
export async function rotateApiKey(
  db: Queryable,
  idOrName: string,
  overlapSeconds: number,
  actor: AuditActor,
): Promise<{ key: string; apiKey: ApiKey }> {
  if (!Number.isInteger(overlapSeconds) || overlapSeconds < 0 || overlapSeconds > MAX_ROTATION_OVERLAP_S) {
    throw new KeyError(422, `The overlap must be 0 to ${MAX_ROTATION_OVERLAP_S} seconds.`)
  }
  const before = await loadKey(db, idOrName)
  if (before.revokedAt) throw new KeyError(422, "A revoked key cannot be rotated. Create a new one.")
  const { key, prefix, hash } = newKey()
  const { rows } = await db.query<ApiKeyRow>(
    `update oauth_api_keys
     set previous_key_hash = case when $4 > 0 then key_hash end,
         previous_key_prefix = case when $4 > 0 then key_prefix end,
         previous_expires_at = case when $4 > 0 then now() + make_interval(secs => $4) end,
         key_hash = $2, key_prefix = $3
     where id = $1 returning ${KEY_COLUMNS}`,
    [before.id, hash, prefix, overlapSeconds],
  )
  const apiKey = toApiKey(rows[0])
  await recordAudit(db, actor, {
    action: "key.rotate",
    apiKey,
    before: { key_prefix: before.keyPrefix },
    after: { key_prefix: apiKey.keyPrefix, overlap_seconds: overlapSeconds },
    outcome: "ok",
  })
  return { key, apiKey }
}

/**
 * The key a bearer value belongs to, or null for a missing, malformed,
 * unknown, revoked or expired one. During a rotation the previous key also
 * counts until its overlap ends.
 */
export async function authenticateApiKey(db: Queryable, presented: string | null): Promise<ApiKey | null> {
  if (!presented || !API_KEY_PATTERN.test(presented)) return null
  const hash = sha256(presented)
  const { rows } = await db.query<ApiKeyRow>(
    `select ${KEY_COLUMNS} from oauth_api_keys
     where (key_hash = $1 or (previous_key_hash = $1 and previous_expires_at > now()))
       and revoked_at is null
       and (expires_at is null or expires_at > now())`,
    [hash],
  )
  const row = rows[0]
  if (!row) return null
  const matches = sameHash(hash, row.key_hash) || (row.previous_key_hash !== null && sameHash(hash, row.previous_key_hash))
  return matches ? toApiKey(row) : null
}

/**
 * Counts one request against the key's one-minute window; false once it is
 * over the limit. In the database so every app process shares the count.
 * Also stamps last_used_at, at most once a minute.
 */
export async function consumeApiKeyRequest(db: Queryable, keyId: string, limit = API_KEY_RATE_LIMIT_PER_MINUTE): Promise<boolean> {
  const { rows } = await db.query<{ request_count: number }>(
    `insert into oauth_api_key_usage (key_id, window_start, request_count)
     values ($1, date_trunc('minute', now()), 1)
     on conflict (key_id, window_start) do update set request_count = oauth_api_key_usage.request_count + 1
     returning request_count`,
    [keyId],
  )
  await db.query(
    `update oauth_api_keys set last_used_at = now()
     where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')`,
    [keyId],
  )
  await db.query("delete from oauth_api_key_usage where key_id = $1 and window_start < now() - interval '1 hour'", [keyId])
  return rows[0].request_count <= limit
}

/** What the audit log keeps about a key: its policy, never the key or hash. */
export function keySnapshot(apiKey: ApiKey) {
  return {
    name: apiKey.name,
    key_prefix: apiKey.keyPrefix,
    allowed_roles: apiKey.allowedRoles,
    allowed_scopes: apiKey.allowedScopes,
    allowed_redirect_hosts: apiKey.allowedRedirectHosts,
    allowed_audiences: apiKey.allowedAudiences,
    max_clients: apiKey.maxClients,
    client_id_prefix: apiKey.clientIdPrefix,
    requires_approval: apiKey.requiresApproval,
    expires_at: apiKey.expiresAt,
    revoked: Boolean(apiKey.revokedAt),
  }
}
