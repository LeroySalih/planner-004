import { randomUUID } from 'node:crypto'
import { decodeJwt } from 'jose'
import type { NextRequest } from 'next/server'

import { GET, OPTIONS } from '@/app/oauth/groups/route'
import { GET as USERINFO } from '@/app/oauth/userinfo/route'
import { query, withDbClient } from '@/lib/db'
import { createFirstPartyClient } from '@/lib/oauth/client-store'
import { buildAccessTokenClaims, buildServiceTokenClaims, signAccessToken } from '@/lib/oauth/jwt'
import { checkAuthorizeRequest, exchangeAuthorizationCode, issueAuthorizationCode } from '@/lib/oauth/server'
import { publicOrigin } from '@/lib/public-origin'
import { authParams, check, deleteUsers, makeUser, pkce, run, users } from './lib'

// GET /oauth/groups (docs/KERF-SSO.md), against a dev database. The route
// handler is called in-process, so no dev server built from this code is
// needed; tokens are minted through the real authorize + token store code.

const URL_ = 'http://localhost:3000/oauth/groups'
const HEADERS = { host: 'localhost:3000' }
const ISSUER = publicOrigin(new Headers(HEADERS))
const CID = `kerftest-groups-${randomUUID().slice(0, 8)}`
const URI = 'https://groups.kerf.test/auth/callback'
const tag = randomUUID().slice(0, 8)
const G1 = `oauthtest-${tag}-a`, G2 = `oauthtest-${tag}-b`, G3 = `oauthtest-${tag}-c`
const groupIds = [G1, G2, G3]
let clientCreated = false

type Json = any // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(token: string | null) {
  const headers: Record<string, string> = { ...HEADERS }
  if (token !== null) headers.authorization = `Bearer ${token}`
  const r = await GET(new Request(URL_, { headers }) as unknown as NextRequest)
  return { status: r.status, json: (await r.json()) as Json, headers: r.headers }
}

async function tokenFor(userId: string, scope: string) {
  const p = pkce()
  const c = await checkAuthorizeRequest(authParams(CID, URI, p.challenge, scope), ISSUER)
  if (c.status !== 'ok') throw new Error(`authorize check failed: ${JSON.stringify(c)}`)
  const code = new URL(await issueAuthorizationCode(c.request, userId)).searchParams.get('code')!
  const t = await exchangeAuthorizationCode({ code, clientId: CID, redirectUri: URI, codeVerifier: p.verifier, issuer: ISSUER })
  return t.access_token
}

const ids = (body: Json) => (body as Array<{ id: string }>).map((g) => g.id)

async function main() {
  await withDbClient((db) => createFirstPartyClient(db, { kind: 'script' }, {
    clientId: CID, clientName: 'Kerf test groups', redirectUris: [URI], allowedRoles: ['pupil', 'teacher', 'admin'],
    allowedScopes: ['profile', 'groups'], audience: 'kerf-sabre', accessTtlSeconds: 900, refreshTtlSeconds: 604800,
  }))
  clientCreated = true

  await query(`insert into groups (group_id, subject, year_group, active) values ($1, 'Design', 10, true), ($2, null, null, null), ($3, 'Art', 9, false)`, groupIds)

  const tMember = await makeUser('tmember', ['teacher'])
  const tTimetable = await makeUser('ttimetable', ['teacher'])
  const tBoth = await makeUser('tboth', ['teacher'])
  const legacy = await makeUser('legacy', [], { isTeacher: true })
  const admin = await makeUser('admin', ['admin'])
  const pupilA = await makeUser('pupila', ['pupil'])
  const pupilB = await makeUser('pupilb', [])
  const pupilGone = await makeUser('pupilgone', ['pupil'])
  const lonely = await makeUser('lonely', ['teacher'])
  await query('update profiles set active = false where user_id = $1', [pupilGone])

  const member = (g: string, u: string) => query('insert into group_membership (group_id, user_id) values ($1, $2)', [g, u])
  for (const u of [tMember, tBoth, legacy, admin, pupilA, pupilB, pupilGone]) await member(G1, u)
  await member(G1, pupilA) // a duplicate membership row
  await member(G2, pupilB)
  await member(G3, tBoth)
  await member(G3, pupilA)
  await query(`insert into timetable_slot_groups (teacher_id, day, period, group_id) values
    ($1, 'sunday', 1, $3), ($1, 'monday', 2, null), ($2, 'sunday', 1, $4), ($2, 'monday', 1, $3), ($2, 'tuesday', 1, $5)`,
  [tTimetable, tBoth, G2, G1, G3])

  const expectedG1Pupils = [pupilA, pupilB].sort()

  // --- teacher via membership only
  const rMember = await call(await tokenFor(tMember, 'groups'))
  check('membership teacher → 200, [G1]', rMember.status === 200 && JSON.stringify(ids(rMember.json)) === JSON.stringify([G1]), JSON.stringify(rMember.json))
  const g1 = rMember.json[0]
  check('G1 shape: id, name = id, subject, year_group', g1.name === G1 && g1.subject === 'Design' && g1.year_group === 10)
  check('G1 pupils: active non-staff members, sorted, no duplicates (no teachers, admins, legacy teacher, inactive)',
    JSON.stringify(g1.pupils) === JSON.stringify(expectedG1Pupils), JSON.stringify(g1.pupils))
  check('exactly five keys per group', (rMember.json as Json[]).every((g) => JSON.stringify(Object.keys(g).sort()) === '["id","name","pupils","subject","year_group"]'))
  check('headers: no-store and CORS *', rMember.headers.get('cache-control') === 'no-store' && rMember.headers.get('access-control-allow-origin') === '*')

  // --- teacher via timetable only (a null-group slot is ignored)
  const rTt = await call(await tokenFor(tTimetable, 'groups'))
  check('timetable teacher → [G2] only', rTt.status === 200 && JSON.stringify(ids(rTt.json)) === JSON.stringify([G2]), JSON.stringify(rTt.json))
  check('G2: null subject and year group, pupil listed', rTt.json[0]?.subject === null && rTt.json[0]?.year_group === null && JSON.stringify(rTt.json[0]?.pupils) === JSON.stringify([pupilB]))

  // --- both: union without duplicates; inactive G3 excluded (member and timetable)
  const bothToken = await tokenFor(tBoth, 'profile groups')
  const rBoth = await call(bothToken)
  check('both teacher → [G1, G2] sorted, no duplicates, inactive G3 left out',
    rBoth.status === 200 && JSON.stringify(ids(rBoth.json)) === JSON.stringify([G1, G2].sort()), JSON.stringify(ids(rBoth.json)))

  // --- userinfo shares the token check; it still answers as before
  const ui = await USERINFO(new Request(URL_.replace('groups', 'userinfo'), { headers: { ...HEADERS, authorization: `Bearer ${bothToken}` } }) as unknown as NextRequest)
  const uiJson = await ui.json()
  check('userinfo (shared check) → sub, roles, name, staff email', ui.status === 200 && uiJson.sub === tBoth
    && JSON.stringify(uiJson.roles) === '["teacher"]' && uiJson.name === 'Test tboth' && String(uiJson.email).startsWith('oauthtest-tboth'), JSON.stringify(uiJson))

  // --- admin: same rule, not every group
  const rAdmin = await call(await tokenFor(admin, 'groups'))
  check('admin → only own groups [G1]', rAdmin.status === 200 && JSON.stringify(ids(rAdmin.json)) === JSON.stringify([G1]), JSON.stringify(ids(rAdmin.json)))

  // --- no groups → empty array
  const rLonely = await call(await tokenFor(lonely, 'groups'))
  check('teacher with no groups → []', rLonely.status === 200 && Array.isArray(rLonely.json) && rLonely.json.length === 0)

  // --- nothing personal anywhere
  const all = JSON.stringify([rMember.json, rTt.json, rBoth.json, rAdmin.json])
  check('no emails or names in any response', !all.includes('@') && !/Test|oauthtest-(tmember|pupil|admin)/.test(all))

  // --- refusals
  const rPupil = await call(await tokenFor(pupilA, 'groups'))
  check('pupil caller → 403 forbidden', rPupil.status === 403 && rPupil.json.error === 'forbidden', JSON.stringify(rPupil.json))
  const rScope = await call(await tokenFor(tMember, 'profile'))
  check('no groups scope → 403 insufficient_scope + WWW-Authenticate',
    rScope.status === 403 && rScope.json.error === 'insufficient_scope'
    && rScope.headers.get('www-authenticate') === 'Bearer error="insufficient_scope", scope="groups"', JSON.stringify(rScope.json))

  const invalid = (r: { status: number; json: Json; headers: Headers }) =>
    r.status === 401 && r.json.error === 'invalid_token' && r.headers.get('www-authenticate') === 'Bearer error="invalid_token"'
    && r.headers.get('access-control-allow-origin') === '*' && r.headers.get('cache-control') === 'no-store'
  check('garbage token → 401', invalid(await call('garbage')))
  check('no Authorization header → 401', invalid(await call(null)))

  const revokedToken = await tokenFor(tMember, 'groups')
  await query('update oauth_tokens set revoked_at = now() where id = $1', [(decodeJwt(revokedToken) as { sid: string }).sid])
  check('revoked connection → 401', invalid(await call(revokedToken)))

  const liveToken = await tokenFor(tMember, 'groups')
  const sid = (decodeJwt(liveToken) as { sid: string }).sid
  await query('update oauth_clients set disabled_at = now() where client_id = $1', [CID])
  check('disabled client → 401', invalid(await call(liveToken)))
  await query('update oauth_clients set disabled_at = null, pending_approval = true where client_id = $1', [CID])
  check('client pending approval → 401', invalid(await call(liveToken)))
  await query('update oauth_clients set pending_approval = false where client_id = $1', [CID])
  check('control: re-enabled client → 200', (await call(liveToken)).status === 200)

  await query('update profiles set active = false where user_id = $1', [tMember])
  check('inactive user → 401', invalid(await call(liveToken)))
  await query('update profiles set active = true where user_id = $1', [tMember])

  const subject = { userId: tMember, roleRows: ['teacher'], isTeacherFlag: false, groupIds: [] }
  const kerf = { clientId: CID, audience: 'kerf-sabre', accessTtlSeconds: 900 }
  const expired = await signAccessToken(buildAccessTokenClaims(subject, kerf, 'groups', { issuer: ISSUER, now: new Date(Date.now() - 3600_000), sid }))
  check('expired token (real key, live connection) → 401', invalid(await call(expired)))
  const fresh = await signAccessToken(buildAccessTokenClaims(subject, kerf, 'groups', { issuer: ISSUER, now: new Date(), sid }))
  check('control: same token unexpired → 200', (await call(fresh)).status === 200)
  const service = await signAccessToken(buildServiceTokenClaims({ clientId: CID, accessTtlSeconds: 300 }, 'kerf-sabre', 'groups', { issuer: ISSUER, now: new Date() }))
  check('service token → 401', invalid(await call(service)))

  // --- roles are read live, not from the JWT
  const ttToken = await tokenFor(tTimetable, 'groups')
  check('timetable teacher token works', (await call(ttToken)).status === 200)
  await query("delete from user_roles where user_id = $1 and role_id = 'teacher'", [tTimetable])
  const rDemoted = await call(ttToken)
  check('teacher role removed after issue → 403 forbidden', rDemoted.status === 403 && rDemoted.json.error === 'forbidden', JSON.stringify(rDemoted.json))

  // --- preflight
  const pre = OPTIONS()
  check('OPTIONS → 204, GET + Authorization, CORS *', pre.status === 204 && /GET/.test(pre.headers.get('access-control-allow-methods') ?? '')
    && /Authorization/i.test(pre.headers.get('access-control-allow-headers') ?? '') && pre.headers.get('access-control-allow-origin') === '*')
}

run(main, async () => {
  if (users.length) await query('delete from timetable_slot_groups where teacher_id = any($1)', [users])
  if (clientCreated) {
    await query('delete from oauth_authorization_codes where client_id = $1', [CID])
    await query('delete from oauth_tokens where client_id = $1', [CID])
    await query('delete from oauth_clients where client_id = $1', [CID])
    await query('delete from oauth_client_audit_log where client_id = $1', [CID])
  }
  await query('delete from group_membership where group_id = any($1)', [groupIds])
  await query('delete from groups where group_id = any($1)', [groupIds])
  await deleteUsers()
  const left = await query<{ n: number }>(
    `select (select count(*) from groups where group_id = any($1))
          + (select count(*) from oauth_clients where client_id = $2)
          + (select count(*) from profiles where user_id = any($3))::int as n`,
    [groupIds, CID, users],
  )
  check('cleanup left nothing behind', Number(left.rows[0].n) === 0)
})
