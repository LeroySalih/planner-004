import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'

import {
  checkRedirectUri,
  ClientValidationError,
  validateClientSettings,
  validateKeyPolicy,
  type ClientCeiling,
  type ClientInput,
} from '@/lib/oauth/clients'
import {
  buildAccessTokenClaims,
  buildServiceTokenClaims,
  JwtKeyError,
  publicJwks,
  signAccessToken,
  verifyAccessJwt,
  verifyServiceJwt,
} from '@/lib/oauth/jwt'
import { effectiveRoles } from '@/lib/roles'
import { check, run } from './lib'

// Pure checks, no database or server: JWT signing and verification
// (docs/KERF-SSO.md), service tokens and the shared client validation
// (docs/FIRST-PARTY-CLIENTS.md).

const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 })
const k1 = pair(), k2 = pair()
const pem1 = k1.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const pub1 = k1.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const pem2 = k2.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const ISS = 'https://dino.test'
const env1 = { OAUTH_JWT_PRIVATE_KEY: pem1.replace(/\n/g, '\\n'), OAUTH_JWT_KEY_ID: 'k1' } as unknown as NodeJS.ProcessEnv
const env2 = { OAUTH_JWT_PRIVATE_KEY: pem2, OAUTH_JWT_KEY_ID: 'k2' } as unknown as NodeJS.ProcessEnv
const env2rot = { ...env2, OAUTH_JWT_PREVIOUS_PUBLIC_KEY: pub1, OAUTH_JWT_PREVIOUS_KEY_ID: 'k1' } as unknown as NodeJS.ProcessEnv

const client = { clientId: 'kerf-editor', audience: 'kerf-sabre', accessTtlSeconds: 900 }
const subject = (roleRows: string[], isTeacherFlag = false, groupIds: string[] = ['26-10-DT']) =>
  ({ userId: randomUUID(), roleRows, isTeacherFlag, groupIds })
const claimsFor = (s: ReturnType<typeof subject>, scope = '', now = new Date()) =>
  buildAccessTokenClaims(s, client, scope, { issuer: ISS, now, sid: randomUUID() })

async function jwtChecks() {
  // buildAccessTokenClaims
  const pupil = claimsFor(subject(['pupil']))
  check('pupil → roles [pupil]', JSON.stringify(pupil.roles) === '["pupil"]')
  check('teacher → roles [teacher]', JSON.stringify(claimsFor(subject(['teacher'])).roles) === '["teacher"]')
  check('legacy is_teacher, no rows → [teacher]', JSON.stringify(claimsFor(subject([], true)).roles) === '["teacher"]')
  check('no role rows → [pupil]', JSON.stringify(claimsFor(subject([])).roles) === '["pupil"]')
  check('admin+pupil+teacher kept as all three', claimsFor(subject(['admin', 'pupil', 'teacher'])).roles.length === 3)
  check('claims shape', pupil.iss === ISS && pupil.aud === 'kerf-sabre' && pupil.exp - pupil.iat === 900 && pupil.nbf === pupil.iat
    && pupil.client_id === 'kerf-editor' && pupil.scope === '' && /^[A-Za-z0-9_-]{22}$/.test(pupil.jti))
  const keys = Object.keys(claimsFor(subject(['pupil']), 'profile groups'))
  check('never a name or email claim', !keys.some((k) => /name|email/i.test(k)), keys.join(','))
  check('groups only with the groups scope', !('groups' in pupil) && JSON.stringify(claimsFor(subject(['teacher']), 'profile groups').groups) === '[{"id":"26-10-DT"}]')
  check('effectiveRoles matches readProfile rules', JSON.stringify(effectiveRoles(['Teacher'], false)) === '["teacher"]')

  // sign + verify
  const token = await signAccessToken(pupil, env1)
  const [h] = token.split('.')
  const header = JSON.parse(Buffer.from(h, 'base64url').toString())
  check('header alg RS256, typ at+jwt, kid', header.alg === 'RS256' && header.typ === 'at+jwt' && header.kid === 'k1', JSON.stringify(header))
  check('verifies (\\n-escaped key)', (await verifyAccessJwt(token, { issuer: ISS, audience: 'kerf-sabre' }, env1))?.sub === pupil.sub)
  const jwks = await publicJwks(env1)
  const jwk = jwks.keys[0] as Record<string, unknown>
  check('JWKS entry', jwk.kty === 'RSA' && jwk.alg === 'RS256' && jwk.use === 'sig' && jwk.kid === 'k1' && !!jwk.n && !!jwk.e && !('d' in jwk))

  check('wrong aud rejected', (await verifyAccessJwt(token, { issuer: ISS, audience: 'other' }, env1)) === null)
  check('wrong iss rejected', (await verifyAccessJwt(token, { issuer: 'https://evil.test' }, env1)) === null)
  const expired = await signAccessToken(claimsFor(subject(['pupil']), '', new Date(Date.now() - 3600_000)), env1)
  check('expired rejected', (await verifyAccessJwt(expired, { issuer: ISS }, env1)) === null)
  const future = await signAccessToken(claimsFor(subject(['pupil']), '', new Date(Date.now() + 3600_000)), env1)
  check('not-yet-valid (nbf) rejected', (await verifyAccessJwt(future, { issuer: ISS }, env1)) === null)
  check('signed by another key (same kid) rejected', (await verifyAccessJwt(await signAccessToken(pupil, { ...env2, OAUTH_JWT_KEY_ID: 'k1' } as unknown as NodeJS.ProcessEnv), { issuer: ISS }, env1)) === null)
  check('unknown kid rejected', (await verifyAccessJwt(await signAccessToken(pupil, env2), { issuer: ISS }, env1)) === null)
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const none = `${b64({ alg: 'none', typ: 'at+jwt', kid: 'k1' })}.${b64(pupil)}.`
  check('alg none rejected', (await verifyAccessJwt(none, { issuer: ISS }, env1)) === null)
  // Classic confusion: HS256 keyed with the public key.
  const hsInput = `${b64({ alg: 'HS256', typ: 'at+jwt', kid: 'k1' })}.${b64(pupil)}`
  const hs = `${hsInput}.${createHmac('sha256', pub1).update(hsInput).digest('base64url')}`
  check('HS256 (public key as secret) rejected', (await verifyAccessJwt(hs, { issuer: ISS }, env1)) === null)
  const plainJwt = await new SignJWT({ ...pupil }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).sign(k1.privateKey)
  check('typ other than at+jwt rejected', (await verifyAccessJwt(plainJwt, { issuer: ISS }, env1)) === null)
  const noSid: Partial<typeof pupil> = { ...pupil }
  delete noSid.sid
  const missing = await new SignJWT({ ...noSid }).setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'k1' }).sign(k1.privateKey)
  check('missing required claim rejected', (await verifyAccessJwt(missing, { issuer: ISS }, env1)) === null)

  // rotation
  check('JWKS lists current and previous during rotation', JSON.stringify((await publicJwks(env2rot)).keys.map((k) => k.kid)) === '["k2","k1"]')
  check('old-key token verifies while PREVIOUS is set', (await verifyAccessJwt(token, { issuer: ISS }, env2rot)) !== null)
  check('old-key token refused once PREVIOUS is removed', (await verifyAccessJwt(token, { issuer: ISS }, env2)) === null)
  check('new-key token verifies', (await verifyAccessJwt(await signAccessToken(pupil, env2rot), { issuer: ISS }, env2rot)) !== null)

  // key problems never yield a token
  for (const [label, env] of [
    ['missing key', {}],
    ['missing kid', { OAUTH_JWT_PRIVATE_KEY: pem1 }],
    ['garbage key', { OAUTH_JWT_PRIVATE_KEY: 'nope', OAUTH_JWT_KEY_ID: 'x' }],
    ['1024-bit key', { OAUTH_JWT_PRIVATE_KEY: generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), OAUTH_JWT_KEY_ID: 'x' }],
  ] as const) {
    try { await signAccessToken(pupil, env as unknown as NodeJS.ProcessEnv); check(`${label}: refuses to sign`, false) }
    catch (e) { check(`${label}: refuses to sign`, e instanceof JwtKeyError, (e as Error).message) }
  }
}


/** The status a validation throws, or 'ok'. */
function outcome(fn: () => unknown): number | 'ok' {
  try {
    fn()
    return 'ok'
  } catch (error) {
    if (error instanceof ClientValidationError) return error.status
    throw error
  }
}

const CEILING: ClientCeiling = {
  allowedRoles: ['pupil', 'teacher'],
  allowedScopes: ['profile', 'svc:read'],
  allowedRedirectHosts: ['app.school.test'],
  allowedAudiences: ['proj', 'other-api'],
  clientIdPrefix: 'proj-',
}
const publicInput = (over: Partial<ClientInput> = {}): ClientInput => ({
  clientId: 'proj-web',
  clientName: 'Project web',
  redirectUris: ['https://app.school.test/cb'],
  allowedRoles: ['pupil'],
  allowedScopes: ['profile'],
  audience: 'proj',
  ...over,
})
const serviceInput = (over: Partial<ClientInput> = {}): ClientInput => ({
  clientId: 'proj-sync',
  clientName: 'Project sync',
  clientType: 'service',
  allowedAudiences: ['other-api'],
  allowedServiceScopes: ['svc:read'],
  ...over,
})

function validationChecks() {
  const ok = validateClientSettings(publicInput(), CEILING)
  check('valid public client passes the ceiling, TTL defaults 900 / 7 days', ok.accessTtlSeconds === 900 && ok.refreshTtlSeconds === 604800)
  check('no ceiling (admin/script): anything well formed', outcome(() => validateClientSettings(publicInput({ clientId: 'x-web', allowedRoles: ['admin'] }), null)) === 'ok')
  check('role outside ceiling → 403', outcome(() => validateClientSettings(publicInput({ allowedRoles: ['pupil', 'admin'] }), CEILING)) === 403)
  check('unknown role → 422', outcome(() => validateClientSettings(publicInput({ allowedRoles: ['root'] }), CEILING)) === 422)
  check('user scope outside ceiling → 403', outcome(() => validateClientSettings(publicInput({ allowedScopes: ['groups'] }), CEILING)) === 403)
  check('unknown user scope → 422', outcome(() => validateClientSettings(publicInput({ allowedScopes: ['email'] }), CEILING)) === 422)
  check('client_id without the prefix → 403', outcome(() => validateClientSettings(publicInput({ clientId: 'other-web' }), CEILING)) === 403)
  check('audience outside ceiling → 403', outcome(() => validateClientSettings(publicInput({ audience: 'kerf-sabre' }), CEILING)) === 403)
  check('redirect host outside ceiling → 403', outcome(() => validateClientSettings(publicInput({ redirectUris: ['https://evil.test/cb'] }), CEILING)) === 403)
  check('subdomain of an allowed host → 403 (exact host)', outcome(() => checkRedirectUri('https://x.app.school.test/cb', CEILING.allowedRedirectHosts)) === 403)
  check('localhost over http always allowed', outcome(() => checkRedirectUri('http://localhost:5173/cb', CEILING.allowedRedirectHosts)) === 'ok'
    && outcome(() => checkRedirectUri('http://127.0.0.1:8080/cb', CEILING.allowedRedirectHosts)) === 'ok')
  for (const [label, uri] of [
    ['http on a real host', 'http://app.school.test/cb'],
    ['fragment', 'https://app.school.test/cb#x'],
    ['userinfo', 'https://user:pw@app.school.test/cb'],
    ['userinfo without password', 'https://user@app.school.test/cb'],
    ['wildcard host', 'https://*.school.test/cb'],
    ['wildcard path', 'https://app.school.test/*'],
    ['relative', '/cb'],
    ['custom scheme', 'kerf://cb'],
    ['whitespace', 'https://app.school.test/c b'],
  ] as const) {
    check(`redirect URI with ${label} → 422`, outcome(() => checkRedirectUri(uri, null)) === 422)
  }
  const many = Array.from({ length: 21 }, (_, i) => `https://app.school.test/cb${i}`)
  check('21 redirect URIs → 422, 20 accepted', outcome(() => validateClientSettings(publicInput({ redirectUris: many }), CEILING)) === 422
    && outcome(() => validateClientSettings(publicInput({ redirectUris: many.slice(0, 20) }), CEILING)) === 'ok')
  check('no redirect URI → 422', outcome(() => validateClientSettings(publicInput({ redirectUris: [] }), CEILING)) === 422)
  check('access TTL over an hour → 422', outcome(() => validateClientSettings(publicInput({ accessTtlSeconds: 7200 }), null)) === 422)

  const svc = validateClientSettings(serviceInput(), CEILING)
  check('valid service client: no redirect URIs, roles or refresh; TTL 300', svc.redirectUris.length === 0 && svc.allowedRoles.length === 0 && svc.refreshTtlSeconds === null && svc.accessTtlSeconds === 300)
  check('service client with a redirect URI → 422', outcome(() => validateClientSettings(serviceInput({ redirectUris: ['https://app.school.test/cb'] }), CEILING)) === 422)
  check('service client with roles → 422', outcome(() => validateClientSettings(serviceInput({ allowedRoles: ['teacher'] }), CEILING)) === 422)
  check('service token TTL outside 5–10 minutes → 422', outcome(() => validateClientSettings(serviceInput({ accessTtlSeconds: 900 }), CEILING)) === 422
    && outcome(() => validateClientSettings(serviceInput({ accessTtlSeconds: 120 }), CEILING)) === 422)
  check('service audience outside ceiling → 403', outcome(() => validateClientSettings(serviceInput({ allowedAudiences: ['payroll'] }), CEILING)) === 403)
  check('service scope outside ceiling → 403', outcome(() => validateClientSettings(serviceInput({ allowedServiceScopes: ['svc:write'] }), CEILING)) === 403)
  check('service client with no audience → 422', outcome(() => validateClientSettings(serviceInput({ allowedAudiences: [] }), CEILING)) === 422)

  const policy = { name: 'proj', clientIdPrefix: 'proj-', allowedRoles: ['pupil'], allowedRedirectHosts: ['app.school.test'] }
  check('key policy: requires_approval defaults to true', validateKeyPolicy(policy).requiresApproval === true)
  check('key policy: wildcard host → 422', outcome(() => validateKeyPolicy({ ...policy, allowedRedirectHosts: ['*.school.test'] })) === 422)
  check('key policy: host with a scheme → 422', outcome(() => validateKeyPolicy({ ...policy, allowedRedirectHosts: ['https://app.school.test'] })) === 422)
  check('key policy: unknown role → 422', outcome(() => validateKeyPolicy({ ...policy, allowedRoles: ['owner'] })) === 422)
  check('key policy: admin only when listed', !validateKeyPolicy(policy).allowedRoles.includes('admin'))
}

async function serviceTokenChecks() {
  const k = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const env = { OAUTH_JWT_PRIVATE_KEY: k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), OAUTH_JWT_KEY_ID: 'ks' } as unknown as NodeJS.ProcessEnv
  const ISS = 'https://dino.test'
  const now = new Date()
  const service = buildServiceTokenClaims({ clientId: 'proj-sync', accessTtlSeconds: 300 }, 'other-api', 'svc:read', { issuer: ISS, now })
  check('service claims: token_use service, sub = client_id, no roles/groups/sid',
    service.token_use === 'service' && service.sub === 'proj-sync' && service.client_id === 'proj-sync'
    && !('roles' in service) && !('groups' in service) && !('sid' in service) && service.exp - service.iat === 300)
  const serviceJwt = await signAccessToken(service, env)
  const user = buildAccessTokenClaims({ userId: randomUUID(), roleRows: ['teacher'], isTeacherFlag: false, groupIds: [] },
    { clientId: 'proj-web', audience: 'other-api', accessTtlSeconds: 900 }, '', { issuer: ISS, now, sid: randomUUID() })
  check('user claims carry token_use user', user.token_use === 'user')
  const userJwt = await signAccessToken(user, env)
  const expected = { issuer: ISS, audience: 'other-api', allowedClients: ['proj-sync', 'proj-web'] }

  check('service token verifies as a service token', (await verifyServiceJwt(serviceJwt, expected, env))?.sub === 'proj-sync')
  check('service token refused as a user token', (await verifyAccessJwt(serviceJwt, { issuer: ISS }, env)) === null)
  check('user token refused as a service token (even with its client allowed)', (await verifyServiceJwt(userJwt, expected, env)) === null)
  check('user token still verifies as a user token', (await verifyAccessJwt(userJwt, { issuer: ISS }, env)) !== null)
  check('service token for another audience refused', (await verifyServiceJwt(serviceJwt, { ...expected, audience: 'payroll' }, env)) === null)
  check('caller not on the allow-list refused', (await verifyServiceJwt(serviceJwt, { ...expected, allowedClients: ['someone-else'] }, env)) === null)
  const expired = await signAccessToken(buildServiceTokenClaims({ clientId: 'proj-sync', accessTtlSeconds: 300 }, 'other-api', '', { issuer: ISS, now: new Date(Date.now() - 3600_000) }), env)
  check('expired service token refused', (await verifyServiceJwt(expired, expected, env)) === null)
  // A user token relabelled as a service token is only possible with the key.
  const forged = await new SignJWT({ ...user, token_use: 'service' })
    .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'ks' })
    .sign(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey)
  check('service token signed by another key refused', (await verifyServiceJwt(forged, expected, env)) === null)
  const noUse = await new SignJWT({ ...user, token_use: undefined })
    .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'ks' })
    .sign(k.privateKey)
  check('token without token_use refused by both verifiers', (await verifyAccessJwt(noUse, { issuer: ISS }, env)) === null
    && (await verifyServiceJwt(noUse, expected, env)) === null)
}

run(async () => {
  await jwtChecks()
  validationChecks()
  await serviceTokenChecks()
}, async () => {})
