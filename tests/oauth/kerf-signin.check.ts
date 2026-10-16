import { generateKeyPairSync } from 'node:crypto'
import { createLocalJWKSet, decodeJwt, jwtVerify, SignJWT } from 'jose'

import { query, withDbClient } from '@/lib/db'
import { createFirstPartyClient } from '@/lib/oauth/client-store'
import { buildAccessTokenClaims, signAccessToken } from '@/lib/oauth/jwt'
import { checkAuthorizeRequest, verifyAccessToken } from '@/lib/oauth/server'
import {
  authParams, BASE, check, codeFor, deleteUsers, exchange, form, issuer, makeUser, mcpCall, pkce, refresh, run, userinfo,
} from './lib'

// Kerf Sabre sign-in (docs/KERF-SSO.md), end to end against a dev database
// and dev server: first-party JWT clients, MCP alongside them unchanged, and
// the MCP_SERVICE_KEY path.

const ED = 'kerftest-editor', ED_URI = 'https://kerf.test/auth/callback'
const AD = 'kerftest-admin', AD_URI = 'https://admin.kerf.test/auth/callback'
const CLIENTS = [
  { clientId: ED, clientName: 'Kerf test editor', redirectUris: [ED_URI, 'http://localhost:5173/auth/callback'],
    allowedRoles: ['pupil', 'teacher', 'admin', 'technician'], allowedScopes: ['profile'], audience: 'kerf-sabre',
    accessTtlSeconds: 900, refreshTtlSeconds: 604800 },
  { clientId: AD, clientName: 'Kerf test admin', redirectUris: [AD_URI], allowedRoles: ['teacher', 'admin'],
    allowedScopes: ['profile', 'groups'], audience: 'kerf-sabre', accessTtlSeconds: 900, refreshTtlSeconds: 604800 },
]
const clients: string[] = []
const mcpClients: string[] = []

async function main() {
  const ORIGIN = await issuer()
  const script = { kind: 'script' } as const
  await withDbClient(async (db) => {
    for (const c of CLIENTS) {
      await createFirstPartyClient(db, script, c)
      clients.push(c.clientId)
    }
  })
  const jwks = createLocalJWKSet(await (await fetch(`${BASE}/oauth/jwks`)).json())
  const verify = async (t: string) => (await jwtVerify(t, jwks, { issuer: ORIGIN, audience: 'kerf-sabre', algorithms: ['RS256'], typ: 'at+jwt' })).payload

  const pupil = await makeUser('pupil', ['pupil'])
  const teacher = await makeUser('teacher', ['teacher'])
  const admin = await makeUser('admin', ['admin', 'pupil', 'teacher'])
  const legacy = await makeUser('legacy', [], { isTeacher: true })
  await query("insert into group_membership (group_id, user_id) select group_id, $1 from groups where active is not false order by group_id desc limit 2", [teacher])
  const teacherGroups = (await query<{ group_id: string }>("select gm.group_id from group_membership gm join groups g using (group_id) where gm.user_id = $1 and g.active is not false order by 1", [teacher])).rows.map((r) => r.group_id)

  // --- kerf-editor, pupil: no consent (first party), JWT with roles [pupil]
  const c1 = await codeFor(ED, ED_URI, pupil, 'profile')
  check('first-party request is marked to skip consent', c1.request.firstParty === true && c1.state === 'st')
  const t1 = await exchange(ED, ED_URI, c1)
  check('pupil code exchange → 200', t1.status === 200, JSON.stringify(t1.json?.error_description ?? ''))
  const at1 = t1.json!.access_token as string
  const claims1 = await verify(at1)
  check('access token is a JWT verified via /oauth/jwks', claims1.sub === pupil)
  check('roles [pupil], aud kerf-sabre, iss = issuer', JSON.stringify(claims1.roles) === '["pupil"]' && claims1.aud === 'kerf-sabre' && claims1.iss === ORIGIN)
  check('expires_in 900 and exp − iat = 900', t1.json!.expires_in === 900 && (claims1.exp! - claims1.iat!) === 900)
  check('scope in response and token', t1.json!.scope === 'profile' && claims1.scope === 'profile')
  check('refresh token is opaque', !String(t1.json!.refresh_token).startsWith('eyJ') && String(t1.json!.refresh_token).length >= 43)
  check('no name/email in token', !Object.keys(claims1).some((k) => /name|email/i.test(k)))
  const row = (await query<{ refresh_expires_at: Date; access_expires_at: Date; scope: string }>('select refresh_expires_at, access_expires_at, scope from oauth_tokens where id = $1', [claims1.sid])).rows[0]
  const refreshDays = (row.refresh_expires_at.getTime() - Date.now()) / 86400_000
  check('token row: 7-day refresh, scope stored', refreshDays > 6.9 && refreshDays < 7.01 && row.scope === 'profile', refreshDays.toFixed(3))
  check('code is single use', (await exchange(ED, ED_URI, c1)).json?.error === 'invalid_grant')
  check('replayed code revoked the connection', (await refresh(ED, t1.json!.refresh_token)).json?.error === 'invalid_grant')

  // --- the same pupil through an MCP client is refused
  const reg = await fetch(`${BASE}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'kerftest mcp', redirect_uris: ['http://localhost:4567/callback'], client_id: ED }) })
  const mcp = await reg.json()
  mcpClients.push(mcp.client_id)
  check('register ignores a requested client_id; new one is not first-party', mcp.client_id !== ED
    && (await query<{ first_party: boolean }>('select first_party from oauth_clients where client_id = $1', [mcp.client_id])).rows[0]?.first_party === false)
  check('first-party client unchanged by that registration', (await query<{ n: number }>("select count(*)::int n from oauth_clients where client_id = $1 and first_party and token_format = 'jwt'", [ED])).rows[0].n === 1)
  const mcpPupil = await codeFor(mcp.client_id, 'http://localhost:4567/callback', pupil)
  check('MCP request is not first party (consent page stays)', mcpPupil.request.firstParty === false)
  const mp = await exchange(mcp.client_id, 'http://localhost:4567/callback', mcpPupil)
  check('pupil through MCP client refused', mp.json?.error === 'invalid_grant' && /teachers/i.test(mp.json?.error_description), mp.json?.error_description)
  const mcpScope = await checkAuthorizeRequest(authParams(mcp.client_id, 'http://localhost:4567/callback', pkce().challenge, 'profile groups'), ORIGIN)
  check('MCP client asking for scopes is not refused (scope ignored)', mcpScope.status === 'ok' && mcpScope.request.scope === '')

  // --- MCP regression: teacher still gets an opaque token that opens /api/MCP
  const mt = await exchange(mcp.client_id, 'http://localhost:4567/callback', await codeFor(mcp.client_id, 'http://localhost:4567/callback', teacher))
  check('MCP teacher gets an opaque token, 1 hour', mt.status === 200 && !String(mt.json!.access_token).startsWith('eyJ') && mt.json!.expires_in === 3600 && mt.json!.scope === '')
  check('opaque MCP token accepted by verifyAccessToken', (await verifyAccessToken(mt.json!.access_token))?.userId === teacher)
  check('opaque MCP token opens /api/MCP', (await mcpCall(mt.json!.access_token)).status === 200)
  check('MCP_SERVICE_KEY still opens /api/MCP', (await mcpCall(process.env.MCP_SERVICE_KEY!)).status === 200)

  // --- kerf-admin refuses a pupil; allows a teacher; groups scope
  const ap = await exchange(AD, AD_URI, await codeFor(AD, AD_URI, pupil))
  check('kerf-admin refuses a pupil', ap.json?.error === 'invalid_grant' && /cannot sign in/.test(ap.json?.error_description), ap.json?.error_description)
  const at = await exchange(AD, AD_URI, await codeFor(AD, AD_URI, teacher, 'profile groups'))
  const tClaims = await verify(at.json!.access_token)
  check('kerf-admin teacher with groups scope gets groups claim', JSON.stringify(tClaims.groups) === JSON.stringify(teacherGroups.map((id) => ({ id }))) && teacherGroups.length > 0, JSON.stringify(tClaims.groups))
  const tNoGroups = await verify((await exchange(AD, AD_URI, await codeFor(AD, AD_URI, teacher, 'profile'))).json!.access_token)
  check('no groups claim without the groups scope', !('groups' in tNoGroups))
  const adm = await verify((await exchange(AD, AD_URI, await codeFor(AD, AD_URI, admin))).json!.access_token)
  check('admin (with pupil role) gets all roles', ['admin', 'pupil', 'teacher'].every((r) => (adm.roles as string[]).includes(r)))
  const leg = await verify((await exchange(ED, ED_URI, await codeFor(ED, ED_URI, legacy))).json!.access_token)
  check('legacy is_teacher user → roles [teacher]', JSON.stringify(leg.roles) === '["teacher"]')

  // --- authorize checks
  const p = pkce().challenge
  const off = await checkAuthorizeRequest(authParams(ED, ED_URI + 'x', p), ORIGIN)
  check('redirect URI one character off → invalid, no redirect', off.status === 'invalid')
  const port = await checkAuthorizeRequest(authParams(ED, 'http://localhost:5174/auth/callback', p), ORIGIN)
  check('first-party loopback on another port → invalid (exact match)', port.status === 'invalid')
  const sc = await checkAuthorizeRequest(authParams(ED, ED_URI, p, 'groups'), ORIGIN)
  check('scope=groups on kerf-editor → invalid_scope to client', sc.status === 'redirect' && new URL(sc.url).searchParams.get('error') === 'invalid_scope' && new URL(sc.url).searchParams.get('state') === 'st')
  const unk = await checkAuthorizeRequest(authParams(ED, ED_URI, p, 'profile email'), ORIGIN)
  check('unknown scope → invalid_scope', unk.status === 'redirect' && new URL(unk.url).searchParams.get('error') === 'invalid_scope')
  const res = await checkAuthorizeRequest({ ...authParams(ED, ED_URI, p), resource: 'https://other' }, ORIGIN)
  check('resource other than audience → invalid_target', res.status === 'redirect' && new URL(res.url).searchParams.get('error') === 'invalid_target')
  const resOk = await checkAuthorizeRequest({ ...authParams(ED, ED_URI, p), resource: 'kerf-sabre' }, ORIGIN)
  check('resource = audience accepted', resOk.status === 'ok')

  // --- refresh: rotation, reuse detection, role removal
  const t2 = await exchange(ED, ED_URI, await codeFor(ED, ED_URI, teacher, 'profile'))
  const r2 = await refresh(ED, t2.json!.refresh_token)
  const c2 = await verify(r2.json!.access_token)
  check('refresh rotates and returns a new JWT', r2.status === 200 && r2.json!.access_token !== t2.json!.access_token && r2.json!.refresh_token !== t2.json!.refresh_token && c2.sub === teacher && r2.json!.scope === 'profile')
  check('same connection (sid) after refresh', c2.sid === decodeJwt(t2.json!.access_token).sid)
  check('old refresh reuse refused', (await refresh(ED, t2.json!.refresh_token)).json?.error === 'invalid_grant')
  check('… and revokes the connection', (await refresh(ED, r2.json!.refresh_token)).json?.error === 'invalid_grant')
  const t3 = await exchange(ED, ED_URI, await codeFor(ED, ED_URI, teacher))
  check('refresh with wrong client_id refused', (await refresh(AD, t3.json!.refresh_token)).json?.error === 'invalid_grant')
  const t4 = await exchange(ED, ED_URI, await codeFor(ED, ED_URI, pupil))
  await query("update oauth_clients set allowed_roles = array['teacher'] where client_id = $1", [ED])
  check('user losing every allowed role cannot refresh', (await refresh(ED, t4.json!.refresh_token)).json?.error === 'invalid_grant')
  await query("update oauth_clients set allowed_roles = array['pupil','teacher','admin','technician'] where client_id = $1", [ED])

  // --- revoke
  const t5 = await exchange(ED, ED_URI, await codeFor(ED, ED_URI, pupil, 'profile'))
  const rv = await form('/oauth/revoke', { token: t5.json!.refresh_token, client_id: ED, token_type_hint: 'refresh_token' })
  check('revoke → 200', rv.status === 200)
  check('refresh after revoke fails', (await refresh(ED, t5.json!.refresh_token)).json?.error === 'invalid_grant')
  check('userinfo after revoke → 401', (await userinfo(t5.json!.access_token)).status === 401)
  check('revoke unknown token → 200', (await form('/oauth/revoke', { token: 'nope', client_id: ED })).status === 200)
  const t6 = await exchange(ED, ED_URI, await codeFor(ED, ED_URI, pupil))
  await form('/oauth/revoke', { token: t6.json!.access_token, client_id: ED })
  check('revoke by access JWT ends the connection', (await refresh(ED, t6.json!.refresh_token)).json?.error === 'invalid_grant')
  check('revoke CORS preflight', (await fetch(`${BASE}/oauth/revoke`, { method: 'OPTIONS' })).headers.get('access-control-allow-origin') === '*')

  // --- userinfo
  const pu = await exchange(ED, ED_URI, await codeFor(ED, ED_URI, pupil, 'profile'))
  const ui = await userinfo(pu.json!.access_token)
  check('userinfo pupil with profile: sub, roles, name, no email', ui.status === 200 && ui.json.sub === pupil && JSON.stringify(ui.json.roles) === '["pupil"]' && ui.json.name === 'Test pupil' && !('email' in ui.json), JSON.stringify(ui.json))
  const pn = await exchange(ED, ED_URI, await codeFor(ED, ED_URI, pupil))
  const ui2 = await userinfo(pn.json!.access_token)
  check('userinfo without profile: no name', ui2.status === 200 && !('name' in ui2.json) && !('email' in ui2.json), JSON.stringify(ui2.json))
  const tu = await userinfo((await exchange(ED, ED_URI, await codeFor(ED, ED_URI, teacher, 'profile'))).json!.access_token)
  check('userinfo teacher with profile includes email', tu.status === 200 && String(tu.json.email).startsWith('oauthtest-teacher'), JSON.stringify(tu.json))
  await query("insert into user_roles (user_id, role_id) values ($1, 'technician')", [pupil])
  check('userinfo roles are live', ((await userinfo(pu.json!.access_token)).json.roles as string[]).includes('technician'))
  await query("delete from user_roles where user_id = $1 and role_id = 'technician'", [pupil])
  const bad = await userinfo('garbage')
  check('userinfo garbage → 401 with WWW-Authenticate', bad.status === 401 && bad.www === 'Bearer error="invalid_token"')
  check('userinfo opaque MCP token → 401', (await userinfo(mt.json!.access_token)).status === 401)
  // Signed with the server's own key (the test shares its .env), so only expiry is wrong.
  const live = decodeJwt(pu.json!.access_token) as { sid: string }
  const expiredClaims = buildAccessTokenClaims({ userId: pupil, roleRows: ['pupil'], isTeacherFlag: false, groupIds: [] },
    { clientId: ED, audience: 'kerf-sabre', accessTtlSeconds: 900 }, 'profile', { issuer: ORIGIN, now: new Date(Date.now() - 3600_000), sid: live.sid })
  check('userinfo expired token (real key, live connection) → 401', (await userinfo(await signAccessToken(expiredClaims))).status === 401)
  const freshClaims = buildAccessTokenClaims({ userId: pupil, roleRows: ['pupil'], isTeacherFlag: false, groupIds: [] },
    { clientId: ED, audience: 'kerf-sabre', accessTtlSeconds: 900 }, 'profile', { issuer: ORIGIN, now: new Date(), sid: live.sid })
  check('control: same token unexpired → 200', (await userinfo(await signAccessToken(freshClaims))).status === 200)
  const header = JSON.parse(Buffer.from(pu.json!.access_token.split('.')[0], 'base64url').toString())
  const forged = await new SignJWT({ ...freshClaims, roles: ['admin'] })
    .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: header.kid })
    .sign(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey)
  check('userinfo forged-key token → 401', (await userinfo(forged)).status === 401)
  const ucors = await fetch(`${BASE}/oauth/userinfo`, { method: 'OPTIONS' })
  check('userinfo preflight allows GET + Authorization', ucors.status === 204 && /GET/.test(ucors.headers.get('access-control-allow-methods') ?? '') && /Authorization/i.test(ucors.headers.get('access-control-allow-headers') ?? ''))

  // --- a Kerf JWT never opens /api/MCP
  const kerfTeacherJwt = (await exchange(ED, ED_URI, await codeFor(ED, ED_URI, teacher))).json!.access_token
  check('Kerf JWT refused by verifyAccessToken', (await verifyAccessToken(kerfTeacherJwt)) === null)
  check('Kerf JWT refused by /api/MCP', (await mcpCall(kerfTeacherJwt)).status === 401)

  // --- pruning keeps first-party clients
  await query("update oauth_clients set created_at = now() - interval '2 days' where client_id = $1", [AD])
  await query('delete from oauth_tokens where client_id = $1', [AD])
  const oldMcp = (await (await fetch(`${BASE}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://localhost:4568/cb'] }) })).json()).client_id
  mcpClients.push(oldMcp)
  await query("update oauth_clients set created_at = now() - interval '2 days' where client_id = $1", [oldMcp])
  await codeFor(ED, ED_URI, pupil) // issuing a code runs pruneExpired
  check('pruneExpired keeps a first-party client with no tokens', (await query('select 1 from oauth_clients where client_id = $1', [AD])).rows.length === 1)
  check('pruneExpired still removes an old unused MCP client', (await query('select 1 from oauth_clients where client_id = $1', [oldMcp])).rows.length === 0)
}

run(main, async () => {
  await query('delete from oauth_clients where client_id = any($1)', [[...clients, ...mcpClients]])
  await query('delete from oauth_client_audit_log where client_id = any($1)', [clients])
  await deleteUsers()
})
