import { createHash, randomBytes, randomUUID } from "node:crypto"

import type { Queryable } from "@/lib/curriculum/unit-curriculum-guard"
import { query, withDbClient } from "@/lib/db"
import { mcpResourceUrl } from "@/lib/oauth/metadata"
import { buildAccessTokenClaims, publicJwks, signAccessToken, verifyAccessJwt, type AccessTokenClaims } from "@/lib/oauth/jwt"
import { effectiveRoles, hasAnyEffectiveRoleSql } from "@/lib/roles"
import type { ConnectedApp, OAuthAuthorizeParams, OAuthClientRegistration } from "@/types"

// OAuth 2.1 authorization server. Two kinds of client share it:
//
//  - MCP clients (Claude) register themselves (RFC 7591). A teacher signs in
//    with their DINO session and approves the client; it gets an opaque access
//    token that verifyMcpAuthorization accepts in place of the service key.
//  - First-party clients (the Kerf Sabre apps, docs/KERF-SSO.md) are
//    pre-registered rows with exact redirect URIs, their own allowed roles and
//    lifetimes, no consent page, and RS256 JWT access tokens (jwt.ts).
//
// Everything a first-party client changes is a column on oauth_clients whose
// default is MCP's behaviour, so an MCP client is handled exactly as before.

const CODE_TTL_MS = 10 * 60 * 1000
const ACCESS_TTL_S = 60 * 60
const REFRESH_TTL_S = 30 * 24 * 60 * 60

/** Every scope a first-party client can be granted. MCP has none. */
export const SUPPORTED_SCOPES = ["profile", "groups"] as const

// Claude's hosted connectors return here: claude.ai web and Desktop, and the
// organisation-managed custom connectors.
const CLAUDE_CALLBACKS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://claude.ai/api/organizations/custom-connectors/oauth/callback",
])

// Who may sign in through the client in `clientAlias`: one of its
// allowed_roles, by the same rule as a DINO session (src/lib/roles.ts). NULL
// keeps MCP's teacher-only rule.
const ALLOWED_FOR_CLIENT = (userColumn: string, clientAlias: string) =>
  hasAnyEffectiveRoleSql(userColumn, `coalesce(${clientAlias}.allowed_roles, array['teacher']::text[])`)

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

type OAuthClient = {
  clientId: string
  clientName: string
  redirectUris: string[]
  firstParty: boolean
  tokenFormat: "opaque" | "jwt"
  allowedRoles: string[] | null
  audience: string | null
  allowedScopes: string[]
  accessTtlSeconds: number
  refreshTtlSeconds: number
}

async function loadClient(db: Queryable, clientId: string): Promise<OAuthClient | null> {
  const { rows } = await db.query<{
    client_id: string
    client_name: string
    redirect_uris: string[]
    first_party: boolean
    token_format: "opaque" | "jwt"
    allowed_roles: string[] | null
    audience: string | null
    allowed_scopes: string[]
    access_ttl_seconds: number | null
    refresh_ttl_seconds: number | null
  }>(
    `select client_id, client_name, redirect_uris, first_party, token_format, allowed_roles,
            audience, allowed_scopes, access_ttl_seconds, refresh_ttl_seconds
     from oauth_clients where client_id = $1`,
    [clientId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: row.redirect_uris,
    firstParty: row.first_party,
    tokenFormat: row.token_format,
    allowedRoles: row.allowed_roles,
    audience: row.audience,
    allowedScopes: row.allowed_scopes,
    accessTtlSeconds: row.access_ttl_seconds ?? ACCESS_TTL_S,
    refreshTtlSeconds: row.refresh_ttl_seconds ?? REFRESH_TTL_S,
  }
}

/** The JS twin of ALLOWED_FOR_CLIENT, for a profile already read from the session. */
export function rolesAllowedByClient(allowedRoles: string[] | null, roles: readonly string[]): boolean {
  return (allowedRoles ?? ["teacher"]).some((role) => roles.includes(role))
}

function newSecret(): string {
  return randomBytes(32).toString("base64url")
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url")
}

/** A Claude Code callback: http on localhost/127.0.0.1 with an explicit port. */
function parseLoopback(uri: string): URL | null {
  if (uri.includes("#")) return null
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    url.port !== "" &&
    !url.username &&
    !url.password
  return loopback ? url : null
}

/** Claude's hosted callbacks, or a loopback port for Claude Code. Dynamic registration only. */
export function isAllowedRedirectUri(uri: string): boolean {
  return CLAUDE_CALLBACKS.has(uri) || parseLoopback(uri) !== null
}

/**
 * For an MCP client: exact match, except that a loopback URI matches on any
 * port (RFC 8252 §7.3), since Claude Code listens on an ephemeral port each
 * session. A first-party client gets an exact string match and nothing else.
 */
function redirectUriMatches(client: OAuthClient, requested: string): boolean {
  if (client.firstParty) return client.redirectUris.includes(requested)
  return client.redirectUris.some((registered) => {
    if (registered === requested) return true
    const a = parseLoopback(registered)
    const b = parseLoopback(requested)
    return Boolean(a && b && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search)
  })
}

/**
 * Open registration, for MCP clients only. It always mints a fresh random
 * client_id and inserts with first_party = false, so it can neither create a
 * first-party client nor touch an existing one.
 */
export async function registerClient(input: OAuthClientRegistration) {
  const rejected = input.redirect_uris.find((uri) => !isAllowedRedirectUri(uri))
  if (rejected) {
    throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${rejected}`)
  }

  const clientId = randomBytes(16).toString("base64url")
  const clientName = input.client_name ?? "MCP client"
  const { rows } = await query<{ created_at: Date }>(
    `insert into oauth_clients (client_id, client_name, redirect_uris, first_party)
     values ($1, $2, $3, false)
     returning created_at`,
    [clientId, clientName, input.redirect_uris],
  )

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(rows[0].created_at.getTime() / 1000),
    client_name: clientName,
    redirect_uris: input.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }
}

export type AuthorizeRequest = {
  clientId: string
  clientName: string
  redirectUri: string
  codeChallenge: string
  state: string | null
  resource: string | null
  scope: string
  /** First-party clients skip the consent page. */
  firstParty: boolean
  /** Who may sign in through this client; null = teachers only. */
  allowedRoles: string[] | null
}

export type AuthorizeCheck =
  // Client or redirect URI unknown: nowhere safe to send the user back to.
  | { status: "invalid"; message: string }
  // The redirect URI is trusted, so the error goes back to the client.
  | { status: "redirect"; url: string }
  | { status: "ok"; request: AuthorizeRequest }

/**
 * The scope to grant, or null if the request asks for one the client may not
 * have. An MCP client has no scopes: whatever it asks for is ignored, as it
 * always was, so advertising scopes_supported cannot break Claude's sign-in.
 */
function grantScope(client: OAuthClient, requested: string | undefined): string | null {
  if (!client.firstParty) return ""
  const asked = [...new Set((requested ?? "").split(" ").filter(Boolean))]
  if (asked.some((scope) => !client.allowedScopes.includes(scope))) return null
  return SUPPORTED_SCOPES.filter((scope) => asked.includes(scope)).join(" ")
}

export async function checkAuthorizeRequest(
  params: OAuthAuthorizeParams,
  origin: string,
): Promise<AuthorizeCheck> {
  if (!params.client_id) {
    return { status: "invalid", message: "The request did not say which app is connecting." }
  }
  const client = await loadClient({ query } as Queryable, params.client_id)
  if (!client) {
    return { status: "invalid", message: "This app is not registered with DINO. Try connecting again." }
  }
  if (!params.redirect_uri || !redirectUriMatches(client, params.redirect_uri)) {
    return { status: "invalid", message: "This app asked to return somewhere it did not register." }
  }

  const state = params.state ?? null
  const fail = (error: string, description: string): AuthorizeCheck => ({
    status: "redirect",
    url: callbackUrl(params.redirect_uri!, { error, error_description: description, state }),
  })

  if (params.response_type !== "code") {
    return fail("unsupported_response_type", "Only response_type=code is supported.")
  }
  if (params.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge ?? "")) {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.")
  }

  let resource: string | null = null
  if (client.tokenFormat === "jwt") {
    // Not required, but if given it must name the token's audience.
    if (params.resource && params.resource !== client.audience) {
      return fail("invalid_target", `Unknown resource: ${params.resource}`)
    }
    resource = params.resource ?? null
  } else {
    resource = params.resource ? params.resource.replace(/\/$/, "") : null
    if (resource && resource !== mcpResourceUrl(origin)) {
      return fail("invalid_target", `Unknown resource: ${params.resource}`)
    }
  }

  const scope = grantScope(client, params.scope)
  if (scope === null) {
    return fail("invalid_scope", `This app may ask for: ${client.allowedScopes.join(" ") || "no scopes"}.`)
  }

  return {
    status: "ok",
    request: {
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge!,
      state,
      resource,
      scope,
      firstParty: client.firstParty,
      allowedRoles: client.allowedRoles,
    },
  }
}

export function callbackUrl(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value)
  }
  return url.toString()
}

/** Approves a checked request; returns the client callback carrying the code. */
export async function issueAuthorizationCode(request: AuthorizeRequest, userId: string): Promise<string> {
  const code = newSecret()
  await query(
    `insert into oauth_authorization_codes
       (code_hash, client_id, user_id, redirect_uri, code_challenge, resource, scope, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      sha256(code),
      request.clientId,
      userId,
      request.redirectUri,
      request.codeChallenge,
      request.resource,
      request.scope,
      new Date(Date.now() + CODE_TTL_MS).toISOString(),
    ],
  )
  await pruneExpired()
  return callbackUrl(request.redirectUri, { code, state: request.state })
}

// Housekeeping on a rare path rather than a cron: spent codes, dead
// connections, and registrations that never led to one (registration is open,
// so those are the rows anyone can create). First-party clients are
// registered by hand and are never pruned. Never allowed to fail an approval.
async function pruneExpired() {
  try {
    await query("delete from oauth_authorization_codes where expires_at < now() - interval '1 day'")
    await query(
      "delete from oauth_tokens where refresh_expires_at < now() or revoked_at < now() - interval '30 days'",
    )
    await query(
      `delete from oauth_clients c
       where c.created_at < now() - interval '24 hours'
         and not c.first_party
         and not exists (select 1 from oauth_tokens t where t.client_id = c.client_id)`,
    )
  } catch (error) {
    console.error("[oauth] Pruning expired rows failed", error)
  }
}

type IssuedTokens = {
  accessToken: string
  refreshToken: string
  accessHash: string
  refreshHash: string
  accessExpiresAt: string
  refreshExpiresAt: string
  expiresIn: number
  scope: string
}

/**
 * A fresh access and refresh token for the connection `tokenId`. The refresh
 * token is always an opaque secret. The access token is too for an MCP
 * client; for a JWT client it is a signed JWT, and signing failures throw
 * rather than fall back to anything weaker.
 */
async function issueTokens(
  db: Queryable,
  client: OAuthClient,
  grant: { tokenId: string; userId: string; scope: string; issuer: string },
): Promise<IssuedTokens> {
  const now = new Date()
  let accessToken: string
  if (client.tokenFormat === "jwt") {
    const subject = await readTokenSubject(db, grant.userId, grant.scope.split(" ").includes("groups"))
    const claims = buildAccessTokenClaims(
      subject,
      { clientId: client.clientId, audience: client.audience!, accessTtlSeconds: client.accessTtlSeconds },
      grant.scope,
      { issuer: grant.issuer, now, sid: grant.tokenId },
    )
    accessToken = await signAccessToken(claims)
  } else {
    accessToken = newSecret()
  }
  const refreshToken = newSecret()
  return {
    accessToken,
    refreshToken,
    accessHash: sha256(accessToken),
    refreshHash: sha256(refreshToken),
    accessExpiresAt: new Date(now.getTime() + client.accessTtlSeconds * 1000).toISOString(),
    refreshExpiresAt: new Date(now.getTime() + client.refreshTtlSeconds * 1000).toISOString(),
    expiresIn: client.accessTtlSeconds,
    scope: grant.scope,
  }
}

/** What a token says about its user: role rows, the legacy flag, active classes. */
async function readTokenSubject(db: Queryable, userId: string, withGroups: boolean) {
  const { rows } = await db.query<{ is_teacher: boolean | null; roles: string[] | null; group_ids: string[] | null }>(
    `select p.is_teacher,
            (select array_agg(ur.role_id) from user_roles ur where ur.user_id = p.user_id) as roles,
            case when $2 then (
              select array_agg(gm.group_id order by gm.group_id)
              from group_membership gm
              join groups g on g.group_id = gm.group_id and g.active is not false
              where gm.user_id = p.user_id
            ) end as group_ids
     from profiles p where p.user_id = $1`,
    [userId, withGroups],
  )
  const row = rows[0]
  if (!row) throw new OAuthError("invalid_grant", "This account no longer exists.")
  return {
    userId,
    roleRows: row.roles ?? [],
    isTeacherFlag: Boolean(row.is_teacher),
    groupIds: row.group_ids ?? [],
  }
}

function tokenResponse(tokens: IssuedTokens) {
  return {
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: tokens.scope,
  }
}

/**
 * Loads the client and, for a JWT client, proves the signing key works before
 * anything is spent: a missing key must not burn the pupil's code.
 */
async function clientForTokenRequest(clientId: string): Promise<OAuthClient | null> {
  const client = await loadClient({ query } as Queryable, clientId)
  if (client?.tokenFormat === "jwt") await publicJwks()
  return client
}

const roleRefusal = (client: OAuthClient | null) =>
  client?.firstParty ? "This account cannot sign in to this app." : "Only teachers can connect to DINO."

export async function exchangeAuthorizationCode(input: {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier: string
  issuer: string
}) {
  const codeHash = sha256(input.code)
  const client = await clientForTokenRequest(input.clientId)

  return withDbClient(async (db) => {
    await db.query("begin")
    // Refusals commit on purpose, so a failed check still burns the code;
    // anything else thrown mid-way rolls back.
    let settled = false
    const commit = async () => {
      await db.query("commit")
      settled = true
    }
    try {
      // Claiming and checking in one statement makes the code single-use even
      // under concurrent exchanges. A failed check still burns it.
      const claimed = await db.query<{
        client_id: string
        user_id: string
        redirect_uri: string
        code_challenge: string
        scope: string
        expired: boolean
        allowed: boolean
      }>(
        `update oauth_authorization_codes c
         set used_at = now()
         from oauth_clients cl
         where c.code_hash = $1 and c.used_at is null and cl.client_id = c.client_id
         returning c.client_id, c.user_id, c.redirect_uri, c.code_challenge, c.scope,
                   c.expires_at <= now() as expired,
                   ${ALLOWED_FOR_CLIENT("c.user_id", "cl")} as allowed`,
        [codeHash],
      )
      const row = claimed.rows[0]

      if (!row) {
        // Unknown, or a replay. A replayed code means it leaked, so whatever
        // it was exchanged for is no longer trustworthy.
        await db.query(
          `update oauth_tokens set revoked_at = now()
           where revoked_at is null
             and id = (select token_id from oauth_authorization_codes where code_hash = $1)`,
          [codeHash],
        )
        await commit()
        throw new OAuthError("invalid_grant", "Authorization code is invalid or has already been used.")
      }

      const failure =
        row.expired ? "Authorization code has expired."
        : !client || row.client_id !== client.clientId ? "Authorization code was issued to another client."
        : row.redirect_uri !== input.redirectUri ? "redirect_uri does not match the authorization request."
        : sha256(input.codeVerifier) !== row.code_challenge ? "PKCE verification failed."
        : !row.allowed ? roleRefusal(client)
        : null
      if (failure || !client) {
        await commit()
        console.info("[oauth] code exchange refused", { clientId: input.clientId, sub: row.user_id })
        throw new OAuthError("invalid_grant", failure ?? "Unknown client.")
      }

      const tokenId = randomUUID()
      const tokens = await issueTokens(db, client, { tokenId, userId: row.user_id, scope: row.scope, issuer: input.issuer })
      await db.query(
        `insert into oauth_tokens
           (id, access_token_hash, refresh_token_hash, client_id, user_id, scope, access_expires_at, refresh_expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tokenId, tokens.accessHash, tokens.refreshHash, row.client_id, row.user_id, row.scope, tokens.accessExpiresAt, tokens.refreshExpiresAt],
      )
      await db.query("update oauth_authorization_codes set token_id = $1 where code_hash = $2", [tokenId, codeHash])
      await commit()
      console.info("[oauth] tokens issued", { clientId: client.clientId, sub: row.user_id, grant: "authorization_code" })
      return tokenResponse(tokens)
    } catch (error) {
      if (!settled) await db.query("rollback")
      throw error
    }
  })
}

/**
 * Rotates in place: the presented refresh token stops working at once. The
 * previous one is kept so that presenting it again — which only a thief or a
 * replaying client can do — revokes the connection (OAuth 2.1 §4.3.1).
 * The user's roles are checked again, so someone who has lost every role the
 * client allows (or been deleted) cannot refresh.
 */
export async function refreshAccessToken(input: { refreshToken: string; clientId: string; issuer: string }) {
  const presented = sha256(input.refreshToken)
  const client = await clientForTokenRequest(input.clientId)

  if (client) {
    const issued = await withDbClient(async (db) => {
      await db.query("begin")
      try {
        const { rows } = await db.query<{ id: string; user_id: string; scope: string }>(
          `select t.id, t.user_id, t.scope
           from oauth_tokens t
           join oauth_clients c on c.client_id = t.client_id
           where t.refresh_token_hash = $1
             and t.revoked_at is null
             and t.refresh_expires_at > now()
             and t.client_id = $2
             and ${ALLOWED_FOR_CLIENT("t.user_id", "c")}
           for update of t`,
          [presented, client.clientId],
        )
        const row = rows[0]
        if (!row) {
          await db.query("rollback")
          return null
        }
        const tokens = await issueTokens(db, client, { tokenId: row.id, userId: row.user_id, scope: row.scope, issuer: input.issuer })
        await db.query(
          `update oauth_tokens
           set access_token_hash = $1, refresh_token_hash = $2, prev_refresh_token_hash = $3,
               access_expires_at = $4, refresh_expires_at = $5
           where id = $6`,
          [tokens.accessHash, tokens.refreshHash, presented, tokens.accessExpiresAt, tokens.refreshExpiresAt, row.id],
        )
        await db.query("commit")
        console.info("[oauth] tokens issued", { clientId: client.clientId, sub: row.user_id, grant: "refresh_token" })
        return tokens
      } catch (error) {
        await db.query("rollback")
        throw error
      }
    })
    if (issued) return tokenResponse(issued)
  }

  const reused = await query(
    "update oauth_tokens set revoked_at = now() where prev_refresh_token_hash = $1 and revoked_at is null",
    [presented],
  )
  if (reused.rowCount) {
    console.warn("[oauth] Rotated-out refresh token presented; connection revoked", { clientId: input.clientId })
  }
  throw new OAuthError("invalid_grant", "Refresh token is invalid, expired or revoked.")
}

/**
 * RFC 7009: ends the connection a refresh token or access token belongs to.
 * The caller answers 200 whether or not anything matched (§2.2).
 */
export async function revokeToken(input: { token: string; clientId: string }): Promise<void> {
  const hash = sha256(input.token)
  const { rows } = await query<{ user_id: string }>(
    `update oauth_tokens set revoked_at = now()
     where client_id = $2 and revoked_at is null
       and (refresh_token_hash = $1 or access_token_hash = $1)
     returning user_id`,
    [hash, input.clientId],
  )
  if (rows[0]) console.info("[oauth] connection revoked", { clientId: input.clientId, sub: rows[0].user_id })
}

/**
 * The teacher an MCP access token acts for, or null if it should be refused.
 * Only opaque tokens count: a first-party JWT's hash is stored too (so its
 * row can be revoked), but it must never open /api/MCP.
 */
export async function verifyAccessToken(token: string): Promise<{ userId: string; clientId: string } | null> {
  const { rows } = await query<{ id: string; user_id: string; client_id: string; stale: boolean }>(
    `select t.id, t.user_id, t.client_id,
            (t.last_used_at is null or t.last_used_at < now() - interval '1 minute') as stale
     from oauth_tokens t
     join oauth_clients c on c.client_id = t.client_id
     where t.access_token_hash = $1
       and c.token_format = 'opaque'
       and t.revoked_at is null
       and t.access_expires_at > now()
       and ${ALLOWED_FOR_CLIENT("t.user_id", "c")}`,
    [sha256(token)],
  )
  const row = rows[0]
  if (!row) return null
  if (row.stale) {
    await query("update oauth_tokens set last_used_at = now() where id = $1", [row.id])
  }
  return { userId: row.user_id, clientId: row.client_id }
}

export type Userinfo = {
  sub: string
  roles: string[]
  name?: string
  email?: string
}

/**
 * GET /oauth/userinfo for a first-party access JWT, or null (→ 401). Checks
 * the signature, issuer and expiry, and that its connection (`sid`) has not
 * been revoked. Read live, so a role change shows before the next refresh.
 * Name and email only with the `profile` scope, and email never for a pupil.
 */
export async function readUserinfo(token: string, issuer: string): Promise<Userinfo | null> {
  let claims: AccessTokenClaims | null
  try {
    claims = await verifyAccessJwt(token, { issuer })
  } catch (error) {
    console.error("[oauth] userinfo could not load the signing keys", error)
    return null
  }
  if (!claims) return null

  const { rows } = await query<{
    first_name: string | null
    last_name: string | null
    email: string | null
    is_teacher: boolean | null
    roles: string[] | null
  }>(
    `select p.first_name, p.last_name, p.email, p.is_teacher,
            (select array_agg(ur.role_id) from user_roles ur where ur.user_id = p.user_id) as roles
     from oauth_tokens t
     join profiles p on p.user_id = t.user_id
     where t.id = $1 and t.client_id = $2 and t.user_id = $3 and t.revoked_at is null`,
    [claims.sid, claims.client_id, claims.sub],
  )
  const row = rows[0]
  if (!row) return null

  const roles = effectiveRoles(row.roles ?? [], Boolean(row.is_teacher))
  const info: Userinfo = { sub: claims.sub, roles }
  if (claims.scope.split(" ").includes("profile")) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ")
    if (name) info.name = name
    if (row.email && (roles.includes("teacher") || roles.includes("admin"))) info.email = row.email
  }
  return info
}

export async function listConnectedApps(userId: string): Promise<ConnectedApp[]> {
  const { rows } = await query<{ id: string; client_name: string; created_at: Date; last_used_at: Date | null }>(
    `select t.id, c.client_name, t.created_at, t.last_used_at
     from oauth_tokens t
     join oauth_clients c on c.client_id = t.client_id
     where t.user_id = $1 and t.revoked_at is null and t.refresh_expires_at > now()
     order by t.created_at desc`,
    [userId],
  )
  return rows.map((row) => ({
    id: row.id,
    client_name: row.client_name,
    created_at: row.created_at.toISOString(),
    last_used_at: row.last_used_at?.toISOString() ?? null,
  }))
}

/** Ends one connection; only its owner can. */
export async function revokeConnectedApp(userId: string, tokenId: string): Promise<boolean> {
  const { rowCount } = await query(
    "update oauth_tokens set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null",
    [tokenId, userId],
  )
  return Boolean(rowCount)
}
