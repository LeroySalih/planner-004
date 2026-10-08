import { createHash, randomBytes } from "node:crypto"

import { query, withDbClient } from "@/lib/db"
import { mcpResourceUrl } from "@/lib/oauth/metadata"
import type { ConnectedApp, OAuthAuthorizeParams, OAuthClientRegistration } from "@/types"

// OAuth 2.1 authorization server for the MCP endpoint. Teachers sign in with
// their DINO session and approve a client; the client gets an access token
// that verifyMcpAuthorization accepts in place of the service key.

const CODE_TTL_MS = 10 * 60 * 1000
const ACCESS_TTL_S = 60 * 60
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Claude's hosted connectors return here: claude.ai web and Desktop, and the
// organisation-managed custom connectors.
const CLAUDE_CALLBACKS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://claude.ai/api/organizations/custom-connectors/oauth/callback",
])

// Mirrors readProfile in src/lib/auth.ts, which is the source of truth for who
// is a teacher (a role row, or the legacy is_teacher flag). Change both together.
const IS_TEACHER = (userColumn: string) => `exists (
  select 1 from profiles p
  where p.user_id = ${userColumn}
    and (p.is_teacher is true
         or exists (select 1 from user_roles ur where ur.user_id = p.user_id and ur.role_id = 'teacher'))
)`

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
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

/** Claude's hosted callbacks, or a loopback port for Claude Code. */
export function isAllowedRedirectUri(uri: string): boolean {
  return CLAUDE_CALLBACKS.has(uri) || parseLoopback(uri) !== null
}

/**
 * Exact match, except that a loopback URI matches on any port (RFC 8252
 * §7.3): Claude Code listens on an ephemeral port each session.
 */
function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true
  const a = parseLoopback(registered)
  const b = parseLoopback(requested)
  return Boolean(
    a && b && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search,
  )
}

export async function registerClient(input: OAuthClientRegistration) {
  const rejected = input.redirect_uris.find((uri) => !isAllowedRedirectUri(uri))
  if (rejected) {
    throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${rejected}`)
  }

  const clientId = randomBytes(16).toString("base64url")
  const clientName = input.client_name ?? "MCP client"
  const { rows } = await query<{ created_at: Date }>(
    `insert into oauth_clients (client_id, client_name, redirect_uris)
     values ($1, $2, $3)
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
}

export type AuthorizeCheck =
  // Client or redirect URI unknown: nowhere safe to send the user back to.
  | { status: "invalid"; message: string }
  // The redirect URI is trusted, so the error goes back to the client.
  | { status: "redirect"; url: string }
  | { status: "ok"; request: AuthorizeRequest }

export async function checkAuthorizeRequest(
  params: OAuthAuthorizeParams,
  origin: string,
): Promise<AuthorizeCheck> {
  if (!params.client_id) {
    return { status: "invalid", message: "The request did not say which app is connecting." }
  }
  const { rows } = await query<{ client_name: string; redirect_uris: string[] }>(
    "select client_name, redirect_uris from oauth_clients where client_id = $1",
    [params.client_id],
  )
  const client = rows[0]
  if (!client) {
    return { status: "invalid", message: "This app is not registered with DINO. Try connecting again." }
  }
  if (!params.redirect_uri || !client.redirect_uris.some((uri) => redirectUriMatches(uri, params.redirect_uri!))) {
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
  const resource = params.resource ? params.resource.replace(/\/$/, "") : null
  if (resource && resource !== mcpResourceUrl(origin)) {
    return fail("invalid_target", `Unknown resource: ${params.resource}`)
  }

  return {
    status: "ok",
    request: {
      clientId: params.client_id,
      clientName: client.client_name,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge!,
      state,
      resource,
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
       (code_hash, client_id, user_id, redirect_uri, code_challenge, resource, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sha256(code),
      request.clientId,
      userId,
      request.redirectUri,
      request.codeChallenge,
      request.resource,
      new Date(Date.now() + CODE_TTL_MS).toISOString(),
    ],
  )
  await pruneExpired()
  return callbackUrl(request.redirectUri, { code, state: request.state })
}

// Housekeeping on a rare path rather than a cron: spent codes, dead
// connections, and registrations that never led to one (registration is open,
// so those are the rows anyone can create). Never allowed to fail an approval.
async function pruneExpired() {
  try {
    await query("delete from oauth_authorization_codes where expires_at < now() - interval '1 day'")
    await query(
      "delete from oauth_tokens where refresh_expires_at < now() or revoked_at < now() - interval '30 days'",
    )
    await query(
      `delete from oauth_clients c
       where c.created_at < now() - interval '24 hours'
         and not exists (select 1 from oauth_tokens t where t.client_id = c.client_id)`,
    )
  } catch (error) {
    console.error("[oauth] Pruning expired rows failed", error)
  }
}

function tokenPair() {
  const accessToken = newSecret()
  const refreshToken = newSecret()
  return {
    accessToken,
    refreshToken,
    accessHash: sha256(accessToken),
    refreshHash: sha256(refreshToken),
    accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
  }
}

function tokenResponse(pair: ReturnType<typeof tokenPair>) {
  return {
    access_token: pair.accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: pair.refreshToken,
  }
}

export async function exchangeAuthorizationCode(input: {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier: string
}) {
  const codeHash = sha256(input.code)

  return withDbClient(async (client) => {
    await client.query("begin")
    try {
      // Claiming and checking in one statement makes the code single-use even
      // under concurrent exchanges. A failed check still burns it.
      const claimed = await client.query<{
        client_id: string
        user_id: string
        redirect_uri: string
        code_challenge: string
        expired: boolean
        is_teacher: boolean
      }>(
        `update oauth_authorization_codes c
         set used_at = now()
         where c.code_hash = $1 and c.used_at is null
         returning c.client_id, c.user_id, c.redirect_uri, c.code_challenge,
                   c.expires_at <= now() as expired,
                   ${IS_TEACHER("c.user_id")} as is_teacher`,
        [codeHash],
      )
      const row = claimed.rows[0]

      if (!row) {
        // Unknown, or a replay. A replayed code means it leaked, so whatever
        // it was exchanged for is no longer trustworthy.
        await client.query(
          `update oauth_tokens set revoked_at = now()
           where revoked_at is null
             and id = (select token_id from oauth_authorization_codes where code_hash = $1)`,
          [codeHash],
        )
        await client.query("commit")
        throw new OAuthError("invalid_grant", "Authorization code is invalid or has already been used.")
      }

      const failure =
        row.expired ? "Authorization code has expired."
        : row.client_id !== input.clientId ? "Authorization code was issued to another client."
        : row.redirect_uri !== input.redirectUri ? "redirect_uri does not match the authorization request."
        : sha256(input.codeVerifier) !== row.code_challenge ? "PKCE verification failed."
        : !row.is_teacher ? "Only teachers can connect to DINO."
        : null
      if (failure) {
        await client.query("commit")
        throw new OAuthError("invalid_grant", failure)
      }

      const pair = tokenPair()
      const inserted = await client.query<{ id: string }>(
        `insert into oauth_tokens
           (access_token_hash, refresh_token_hash, client_id, user_id, access_expires_at, refresh_expires_at)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [pair.accessHash, pair.refreshHash, row.client_id, row.user_id, pair.accessExpiresAt, pair.refreshExpiresAt],
      )
      await client.query("update oauth_authorization_codes set token_id = $1 where code_hash = $2", [
        inserted.rows[0].id,
        codeHash,
      ])
      await client.query("commit")
      return tokenResponse(pair)
    } catch (error) {
      if (!(error instanceof OAuthError)) await client.query("rollback")
      throw error
    }
  })
}

/**
 * Rotates in place: the presented refresh token stops working at once. The
 * previous one is kept so that presenting it again — which only a thief or a
 * replaying client can do — revokes the connection (OAuth 2.1 §4.3.1).
 */
export async function refreshAccessToken(input: { refreshToken: string; clientId: string }) {
  const presented = sha256(input.refreshToken)
  const pair = tokenPair()
  const { rowCount } = await query(
    `update oauth_tokens t
     set access_token_hash = $1, refresh_token_hash = $2, prev_refresh_token_hash = $5,
         access_expires_at = $3, refresh_expires_at = $4
     where t.refresh_token_hash = $5
       and t.revoked_at is null
       and t.refresh_expires_at > now()
       and t.client_id = $6
       and ${IS_TEACHER("t.user_id")}`,
    [pair.accessHash, pair.refreshHash, pair.accessExpiresAt, pair.refreshExpiresAt, presented, input.clientId],
  )
  if (rowCount) return tokenResponse(pair)

  const reused = await query(
    "update oauth_tokens set revoked_at = now() where prev_refresh_token_hash = $1 and revoked_at is null",
    [presented],
  )
  if (reused.rowCount) {
    console.warn("[oauth] Rotated-out refresh token presented; connection revoked")
  }
  throw new OAuthError("invalid_grant", "Refresh token is invalid, expired or revoked.")
}

/** The teacher an access token acts for, or null if it should be refused. */
export async function verifyAccessToken(token: string): Promise<string | null> {
  const { rows } = await query<{ id: string; user_id: string; stale: boolean }>(
    `select t.id, t.user_id,
            (t.last_used_at is null or t.last_used_at < now() - interval '1 minute') as stale
     from oauth_tokens t
     where t.access_token_hash = $1
       and t.revoked_at is null
       and t.access_expires_at > now()
       and ${IS_TEACHER("t.user_id")}`,
    [sha256(token)],
  )
  const row = rows[0]
  if (!row) return null
  if (row.stale) {
    await query("update oauth_tokens set last_used_at = now() where id = $1", [row.id])
  }
  return row.user_id
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
