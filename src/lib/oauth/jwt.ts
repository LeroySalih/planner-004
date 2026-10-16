import { createPrivateKey, createPublicKey, randomBytes, type KeyObject } from "node:crypto"

import { createLocalJWKSet, exportJWK, jwtVerify, SignJWT, type JWK, type JWTPayload } from "jose"

import { effectiveRoles } from "@/lib/roles"

// RS256 access tokens for first-party clients (oauth_clients.token_format =
// 'jwt'), verified offline by the resource server through /oauth/jwks. MCP
// clients never get one: their tokens stay opaque (src/lib/oauth/server.ts).
//
// Keys come from the environment (docs/KERF-SSO.md):
//   OAUTH_JWT_PRIVATE_KEY   RSA private key, PKCS#8 PEM (\n escapes allowed)
//   OAUTH_JWT_KEY_ID        its kid
//   OAUTH_JWT_PREVIOUS_PUBLIC_KEY / OAUTH_JWT_PREVIOUS_KEY_ID
//                           the key being rotated out, still published so its
//                           tokens verify until they expire.

const ALG = "RS256"
const TOKEN_TYPE = "at+jwt" // RFC 9068
const MIN_MODULUS_BITS = 2048

/** A signing key is missing or unusable. Never answered with an unsigned token. */
export class JwtKeyError extends Error {}

type SigningKeys = {
  privateKey: KeyObject
  kid: string
  jwks: { keys: JWK[] }
}

let cached: { source: string; keys: SigningKeys } | null = null

// Tolerates surrounding quotes, which `docker run --env-file` keeps verbatim.
const pem = (value: string | undefined) => value?.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n") || null

function rsaPublicKey(key: KeyObject, name: string): KeyObject {
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0
  if (key.asymmetricKeyType !== "rsa" || bits < MIN_MODULUS_BITS) {
    throw new JwtKeyError(`${name} must be an RSA key of at least ${MIN_MODULUS_BITS} bits`)
  }
  return key.type === "private" ? createPublicKey(key) : key
}

async function publicJwk(key: KeyObject, kid: string): Promise<JWK> {
  const { kty, n, e } = await exportJWK(key)
  return { kty, n, e, use: "sig", alg: ALG, kid }
}

/** Reads and checks the keys once per distinct configuration. */
async function signingKeys(env: NodeJS.ProcessEnv = process.env): Promise<SigningKeys> {
  const privatePem = pem(env.OAUTH_JWT_PRIVATE_KEY)
  const kid = env.OAUTH_JWT_KEY_ID?.trim()
  const previousPem = pem(env.OAUTH_JWT_PREVIOUS_PUBLIC_KEY)
  const previousKid = env.OAUTH_JWT_PREVIOUS_KEY_ID?.trim()
  if (!privatePem || !kid) {
    throw new JwtKeyError("OAUTH_JWT_PRIVATE_KEY and OAUTH_JWT_KEY_ID must be set to issue JWT access tokens")
  }

  const source = [privatePem, kid, previousPem, previousKid].join("\0")
  if (cached?.source === source) return cached.keys

  let privateKey: KeyObject
  try {
    privateKey = createPrivateKey(privatePem)
  } catch {
    throw new JwtKeyError("OAUTH_JWT_PRIVATE_KEY is not a readable PEM private key")
  }
  const keys = [await publicJwk(rsaPublicKey(privateKey, "OAUTH_JWT_PRIVATE_KEY"), kid)]

  if (previousPem && previousKid && previousKid !== kid) {
    let previous: KeyObject
    try {
      previous = createPublicKey(previousPem)
    } catch {
      throw new JwtKeyError("OAUTH_JWT_PREVIOUS_PUBLIC_KEY is not a readable PEM public key")
    }
    keys.push(await publicJwk(rsaPublicKey(previous, "OAUTH_JWT_PREVIOUS_PUBLIC_KEY"), previousKid))
  }

  const result = { privateKey, kid, jwks: { keys } }
  cached = { source, keys: result }
  return result
}

/** The JWKS document: the current public key, and the previous one during a rotation. */
export async function publicJwks(env?: NodeJS.ProcessEnv): Promise<{ keys: JWK[] }> {
  return (await signingKeys(env)).jwks
}

export type AccessTokenSubject = {
  userId: string
  /** user_roles rows; the effective roles are derived as for a DINO session. */
  roleRows: readonly string[]
  isTeacherFlag: boolean
  /** The user's active class memberships; only used when `groups` is granted. */
  groupIds: readonly string[]
}

export type AccessTokenClient = {
  clientId: string
  audience: string
  accessTtlSeconds: number
}

export type AccessTokenClaims = {
  iss: string
  sub: string
  aud: string
  iat: number
  nbf: number
  exp: number
  jti: string
  /** The oauth_tokens row (one connection), so userinfo can check it is not revoked. */
  sid: string
  client_id: string
  scope: string
  roles: string[]
  groups?: Array<{ id: string }>
}

/**
 * The claims of one access token. Pure, so it is tested without a database.
 * Deliberately no name or email: tokens end up in browser storage, headers
 * and proxy logs. A client reads those, for display only, from userinfo.
 */
export function buildAccessTokenClaims(
  subject: AccessTokenSubject,
  client: AccessTokenClient,
  scope: string,
  context: { issuer: string; now: Date; sid: string; jti?: string },
): AccessTokenClaims {
  const iat = Math.floor(context.now.getTime() / 1000)
  const claims: AccessTokenClaims = {
    iss: context.issuer,
    sub: subject.userId,
    aud: client.audience,
    iat,
    nbf: iat,
    exp: iat + client.accessTtlSeconds,
    jti: context.jti ?? randomBytes(16).toString("base64url"),
    sid: context.sid,
    client_id: client.clientId,
    scope,
    roles: effectiveRoles(subject.roleRows, subject.isTeacherFlag),
  }
  if (scope.split(" ").includes("groups")) {
    claims.groups = subject.groupIds.map((id) => ({ id }))
  }
  return claims
}

/** Signs with the current key. Throws JwtKeyError rather than ever issuing an unsigned token. */
export async function signAccessToken(claims: AccessTokenClaims, env?: NodeJS.ProcessEnv): Promise<string> {
  const { privateKey, kid } = await signingKeys(env)
  return new SignJWT({ ...claims } as JWTPayload)
    .setProtectedHeader({ alg: ALG, typ: TOKEN_TYPE, kid })
    .sign(privateKey)
}

/**
 * The claims of a token this server signed, or null. Pins RS256 (so `none` and
 * HS256 are refused), requires typ at+jwt, and checks iss, exp and nbf, plus
 * aud when given.
 */
export async function verifyAccessJwt(
  token: string,
  expected: { issuer: string; audience?: string },
  env?: NodeJS.ProcessEnv,
): Promise<AccessTokenClaims | null> {
  const keySet = createLocalJWKSet(await publicJwks(env))
  try {
    const { payload } = await jwtVerify(token, keySet, {
      algorithms: [ALG],
      typ: TOKEN_TYPE,
      issuer: expected.issuer,
      audience: expected.audience,
      requiredClaims: ["sub", "exp", "nbf", "jti", "sid", "client_id"],
      clockTolerance: 5,
    })
    return payload as unknown as AccessTokenClaims
  } catch {
    return null
  }
}

