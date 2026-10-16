// The one set of rules for a first-party OAuth client's settings, used by every
// surface that creates or changes one: the admin UI, scripts/
// register-oauth-client.ts and the project-key API (/api/oauth-clients).
// Pure, so it is testable without a database. docs/FIRST-PARTY-CLIENTS.md.
//
// Two kinds of first-party client:
//   - public: signs people in with PKCE (the Kerf apps). Exact redirect URIs.
//   - service: confidential, client_credentials only. Acts as itself, never
//     as a person, so it has no redirect URIs, roles or user scopes.
//
// A project key adds a ceiling: nothing its clients are given may exceed it.
// An admin or a script has no ceiling, but the same format rules.

export const CLIENT_ROLES = ["pupil", "teacher", "admin", "technician"] as const

/** Scopes a public client can be granted. */
export const USER_SCOPES = ["profile", "groups"] as const

export const MAX_REDIRECT_URIS = 20
const MAX_URI_LENGTH = 2048

export const TTL_LIMITS = {
  // A user JWT cannot be revoked before it expires (docs/KERF-SSO.md).
  publicAccess: { min: 60, max: 3600, fallback: 900 },
  publicRefresh: { min: 3600, max: 30 * 24 * 60 * 60, fallback: 7 * 24 * 60 * 60 },
  // Service tokens live 5 to 10 minutes and are never refreshed.
  serviceAccess: { min: 300, max: 600, fallback: 300 },
} as const

const CLIENT_ID = /^[A-Za-z0-9_-]{3,64}$/
const AUDIENCE = /^[a-z0-9][a-z0-9._-]{1,63}$/
const SCOPE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/
const CLIENT_ID_PREFIX = /^[A-Za-z0-9_-]{2,32}$/

/** 422: the input is malformed. 403: well formed, but outside the key's ceiling. */
export class ClientValidationError extends Error {
  constructor(
    readonly status: 403 | 422,
    message: string,
  ) {
    super(message)
  }
}

const invalid = (message: string): never => {
  throw new ClientValidationError(422, message)
}
const forbidden = (message: string): never => {
  throw new ClientValidationError(403, message)
}

export type ClientType = "public" | "service"

export type ClientSettings = {
  clientId: string
  clientName: string
  clientType: ClientType
  redirectUris: string[]
  /** Public: who may sign in. Service: always empty. */
  allowedRoles: string[]
  /** Public: user scopes (profile, groups). Service: always empty. */
  allowedScopes: string[]
  /** Public: the JWT `aud`. Service: null (chosen per token request). */
  audience: string | null
  /** Service: audiences it may ask a token for. Public: always empty. */
  allowedAudiences: string[]
  /** Service: scopes it may ask for. Public: always empty. */
  allowedServiceScopes: string[]
  accessTtlSeconds: number
  /** Public only; service clients never get a refresh token. */
  refreshTtlSeconds: number | null
}

export type ClientCeiling = {
  allowedRoles: string[]
  allowedScopes: string[]
  allowedRedirectHosts: string[]
  allowedAudiences: string[]
  clientIdPrefix: string
}

const isLoopbackHost = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1"

/**
 * One redirect URI, matched exactly at sign-in, so no patterns of any kind:
 * https (or http on localhost/127.0.0.1), no fragment, no userinfo, no
 * wildcard. With `allowedHosts`, the host must be one of them exactly;
 * localhost and 127.0.0.1 are always allowed.
 */
export function checkRedirectUri(uri: string, allowedHosts: readonly string[] | null): void {
  if (typeof uri !== "string" || uri.length === 0) invalid("A redirect URI cannot be empty.")
  if (uri.length > MAX_URI_LENGTH) invalid(`Redirect URIs are limited to ${MAX_URI_LENGTH} characters.`)
  if (/[\s*]/.test(uri)) invalid(`Redirect URIs cannot contain spaces or wildcards: ${uri}`)
  if (uri.includes("#")) invalid(`Redirect URIs cannot have a fragment: ${uri}`)
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return invalid(`Not an absolute URL: ${uri}`)
  }
  if (url.username || url.password || /^[a-z]+:\/\/[^/]*@/i.test(uri)) {
    invalid(`Redirect URIs cannot carry a user name or password: ${uri}`)
  }
  const loopback = isLoopbackHost(url.hostname)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    invalid(`Use https, or http only on localhost: ${uri}`)
  }
  if (allowedHosts && !loopback && !allowedHosts.includes(url.hostname)) {
    forbidden(`${url.hostname} is not a redirect host this project may use.`)
  }
}

function list(values: unknown, label: string): string[] {
  if (values === undefined || values === null) return []
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    return invalid(`${label} must be a list of strings.`)
  }
  return [...new Set((values as string[]).map((value) => value.trim()).filter(Boolean))]
}

function seconds(value: number | null | undefined, limits: { min: number; max: number; fallback: number }, label: string): number {
  const n = value ?? limits.fallback
  if (!Number.isInteger(n) || n < limits.min || n > limits.max) {
    invalid(`${label} must be a whole number of seconds from ${limits.min} to ${limits.max}.`)
  }
  return n
}

export type ClientInput = {
  clientId: string
  clientName: string
  clientType?: ClientType
  redirectUris?: unknown
  allowedRoles?: unknown
  allowedScopes?: unknown
  audience?: string | null
  allowedAudiences?: unknown
  allowedServiceScopes?: unknown
  accessTtlSeconds?: number | null
  refreshTtlSeconds?: number | null
}

/**
 * Checks and normalises a client's full settings, for a create or for the
 * result of a change. Format problems throw 422, ceiling problems 403.
 */
export function validateClientSettings(input: ClientInput, ceiling: ClientCeiling | null): ClientSettings {
  const clientType = input.clientType ?? "public"
  if (clientType !== "public" && clientType !== "service") invalid("client_type must be public or service.")

  const clientId = typeof input.clientId === "string" ? input.clientId.trim() : ""
  if (!CLIENT_ID.test(clientId)) invalid("client_id may use letters, digits, _ and -, 3 to 64 characters.")
  const clientName = typeof input.clientName === "string" ? input.clientName.trim() : ""
  if (clientName.length === 0 || clientName.length > 100) invalid("client_name must be 1 to 100 characters.")

  const redirectUris = list(input.redirectUris, "redirect_uris")
  const allowedRoles = list(input.allowedRoles, "roles").map((role) => role.toLowerCase())
  const allowedScopes = list(input.allowedScopes, "scopes")
  const allowedAudiences = list(input.allowedAudiences, "allowed_audiences")
  const allowedServiceScopes = list(input.allowedServiceScopes, "service_scopes")
  const audience = input.audience?.trim() || null

  let settings: ClientSettings
  if (clientType === "public") {
    if (redirectUris.length === 0) invalid("A client needs at least one redirect URI.")
    if (redirectUris.length > MAX_REDIRECT_URIS) invalid(`A client can have at most ${MAX_REDIRECT_URIS} redirect URIs.`)
    for (const uri of redirectUris) checkRedirectUri(uri, null)
    if (allowedRoles.length === 0) invalid(`roles must be some of ${CLIENT_ROLES.join(", ")}.`)
    const badRole = allowedRoles.find((role) => !(CLIENT_ROLES as readonly string[]).includes(role))
    if (badRole) invalid(`Unknown role ${badRole}: use some of ${CLIENT_ROLES.join(", ")}.`)
    const badScope = allowedScopes.find((scope) => !(USER_SCOPES as readonly string[]).includes(scope))
    if (badScope) invalid(`Unknown scope ${badScope}: use some of ${USER_SCOPES.join(", ")}.`)
    if (!audience || !AUDIENCE.test(audience)) invalid("audience must be 2 to 64 lower-case letters, digits, '.', '_' or '-'.")
    if (allowedAudiences.length || allowedServiceScopes.length) {
      invalid("allowed_audiences and service_scopes are for service clients only.")
    }
    settings = {
      clientId,
      clientName,
      clientType,
      redirectUris,
      allowedRoles,
      allowedScopes,
      audience,
      allowedAudiences: [],
      allowedServiceScopes: [],
      accessTtlSeconds: seconds(input.accessTtlSeconds, TTL_LIMITS.publicAccess, "access_ttl_seconds"),
      refreshTtlSeconds: seconds(input.refreshTtlSeconds, TTL_LIMITS.publicRefresh, "refresh_ttl_seconds"),
    }
  } else {
    if (redirectUris.length) invalid("A service client signs nobody in, so it has no redirect URIs.")
    if (allowedRoles.length || allowedScopes.length) invalid("A service client acts as itself: no roles or user scopes.")
    if (audience) invalid("A service client names its audiences in allowed_audiences.")
    if (input.refreshTtlSeconds !== undefined && input.refreshTtlSeconds !== null) {
      invalid("A service client never gets a refresh token.")
    }
    if (allowedAudiences.length === 0) invalid("A service client needs at least one allowed audience.")
    const badAudience = allowedAudiences.find((value) => !AUDIENCE.test(value))
    if (badAudience) invalid(`Malformed audience: ${badAudience}`)
    const badScope = allowedServiceScopes.find((value) => !SCOPE.test(value))
    if (badScope) invalid(`Malformed scope: ${badScope}`)
    settings = {
      clientId,
      clientName,
      clientType,
      redirectUris: [],
      allowedRoles: [],
      allowedScopes: [],
      audience: null,
      allowedAudiences,
      allowedServiceScopes,
      accessTtlSeconds: seconds(input.accessTtlSeconds, TTL_LIMITS.serviceAccess, "access_ttl_seconds"),
      refreshTtlSeconds: null,
    }
  }

  if (ceiling) checkCeiling(settings, ceiling)
  return settings
}

function checkCeiling(settings: ClientSettings, ceiling: ClientCeiling) {
  if (!settings.clientId.startsWith(ceiling.clientIdPrefix)) {
    forbidden(`client_id must start with ${ceiling.clientIdPrefix}.`)
  }
  const role = settings.allowedRoles.find((value) => !ceiling.allowedRoles.includes(value))
  if (role) forbidden(`This project may not allow the ${role} role.`)
  const scope = [...settings.allowedScopes, ...settings.allowedServiceScopes].find(
    (value) => !ceiling.allowedScopes.includes(value),
  )
  if (scope) forbidden(`This project may not grant the ${scope} scope.`)
  const audience = [...(settings.audience ? [settings.audience] : []), ...settings.allowedAudiences].find(
    (value) => !ceiling.allowedAudiences.includes(value),
  )
  if (audience) forbidden(`This project may not use the ${audience} audience.`)
  for (const uri of settings.redirectUris) checkRedirectUri(uri, ceiling.allowedRedirectHosts)
}

export type KeyPolicyInput = {
  name: string
  allowedRoles: unknown
  allowedScopes?: unknown
  allowedRedirectHosts: unknown
  allowedAudiences?: unknown
  maxClients?: number
  clientIdPrefix: string
  requiresApproval?: boolean
  expiresAt?: Date | null
}

export type KeyPolicy = ClientCeiling & {
  name: string
  maxClients: number
  requiresApproval: boolean
  expiresAt: Date | null
}

/** A project key's ceiling. 'admin' is allowed only because it is listed explicitly. */
export function validateKeyPolicy(input: KeyPolicyInput): KeyPolicy {
  const name = typeof input.name === "string" ? input.name.trim() : ""
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(name)) invalid("name must be 2 to 64 lower-case letters, digits, '.', '_' or '-'.")
  const allowedRoles = list(input.allowedRoles, "roles").map((role) => role.toLowerCase())
  if (allowedRoles.length === 0) invalid(`roles must be some of ${CLIENT_ROLES.join(", ")}.`)
  const badRole = allowedRoles.find((role) => !(CLIENT_ROLES as readonly string[]).includes(role))
  if (badRole) invalid(`Unknown role ${badRole}.`)
  const allowedScopes = list(input.allowedScopes, "scopes")
  const badScope = allowedScopes.find((scope) => !SCOPE.test(scope))
  if (badScope) invalid(`Malformed scope: ${badScope}`)
  const allowedRedirectHosts = list(input.allowedRedirectHosts, "redirect hosts").map((host) => host.toLowerCase())
  const badHost = allowedRedirectHosts.find((host) => !HOSTNAME.test(host))
  if (badHost) invalid(`Not a host name (no schemes, ports or wildcards): ${badHost}`)
  const allowedAudiences = list(input.allowedAudiences, "audiences")
  const badAudience = allowedAudiences.find((value) => !AUDIENCE.test(value))
  if (badAudience) invalid(`Malformed audience: ${badAudience}`)
  const maxClients = input.maxClients ?? 5
  if (!Number.isInteger(maxClients) || maxClients < 0 || maxClients > 100) invalid("max_clients must be 0 to 100.")
  const clientIdPrefix = typeof input.clientIdPrefix === "string" ? input.clientIdPrefix.trim() : ""
  if (!CLIENT_ID_PREFIX.test(clientIdPrefix)) invalid("client_id_prefix must be 2 to 32 letters, digits, _ or -.")
  const expiresAt = input.expiresAt ?? null
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
    invalid("expires_at must be in the future.")
  }
  return {
    name,
    allowedRoles,
    allowedScopes,
    allowedRedirectHosts,
    allowedAudiences,
    maxClients,
    clientIdPrefix,
    requiresApproval: input.requiresApproval ?? true,
    expiresAt,
  }
}
