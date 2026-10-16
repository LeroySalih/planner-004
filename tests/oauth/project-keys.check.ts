import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose'

import { query, withDbClient } from '@/lib/db'
import { createApiKey, revokeApiKey, rotateApiKey } from '@/lib/oauth/api-keys'
import { setClientEnabled, sha256 } from '@/lib/oauth/client-store'
import { verifyAccessJwt, verifyServiceJwt } from '@/lib/oauth/jwt'
import { checkAuthorizeRequest } from '@/lib/oauth/server'
import { authParams, BASE, check, codeFor, deleteUsers, exchange, form, issuer, makeUser, mcpCall, pkce, refresh, run, userinfo } from './lib'

// Project API keys and service tokens (docs/FIRST-PARTY-CLIENTS.md), end to
// end against a dev database and dev server.

const script = { kind: 'script' } as const
const keyNames: string[] = []
const mcpClients: string[] = []
const secrets: string[] = []

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(key: string | null, method: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}/api/oauth-clients${path}`, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: r.status, json: (await r.json().catch(() => null)) as Json, headers: r.headers }
}

async function newKey(name: string, over: Record<string, unknown> = {}) {
  const { key, apiKey } = await withDbClient((db) =>
    createApiKey(db, {
      name,
      clientIdPrefix: `${name.replace('oauthtest-', 'ot')}-`,
      allowedRoles: ['pupil', 'teacher'],
      allowedScopes: ['profile', 'groups', 'svc:read'],
      allowedRedirectHosts: [`${name}.test`],
      allowedAudiences: [`${name}-aud`, 'otsvc-target'],
      maxClients: 4,
      ...over,
    }, script),
  )
  keyNames.push(name)
  secrets.push(key)
  return { key, apiKey, prefix: apiKey.clientIdPrefix, host: `${name}.test`, aud: `${name}-aud` }
}

const approve = (clientId: string) => withDbClient((db) => setClientEnabled(db, script, clientId, true))

const basic = (id: string, secret: string) => ({
  authorization: `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`,
})
const serviceToken = (id: string, secret: string, extra: Record<string, string> = {}) =>
  form('/oauth/token', { grant_type: 'client_credentials', audience: 'otsvc-target', ...extra }, basic(id, secret))

async function main() {
  const ISS = await issuer()
  const A = await newKey('oauthtest-a')
  const B = await newKey('oauthtest-b', { requiresApproval: false })

  // --- keys: shown once, only the hash stored
  check('key format dino_pk_ + 43 chars', /^dino_pk_[A-Za-z0-9_-]{43}$/.test(A.key))
  const row = (await query<Json>('select * from oauth_api_keys where name = $1', [A.apiKey.name])).rows[0]
  check('stored: SHA-256 and an 8-char prefix, never the key', row.key_hash === sha256(A.key) && row.key_prefix === A.key.slice(8, 16)
    && !JSON.stringify(row).includes(A.key.slice(8)))
  check('new keys require approval by default', row.requires_approval === true)

  // --- 401s
  const none = await api(null, 'GET', '')
  check('no key → 401 with WWW-Authenticate: Bearer', none.status === 401 && /^Bearer/.test(none.headers.get('www-authenticate') ?? ''))
  check('unknown key → 401', (await api(`dino_pk_${'x'.repeat(43)}`, 'GET', '')).status === 401)
  check('garbage key → 401', (await api('garbage', 'GET', '')).status === 401)
  const R = await newKey('oauthtest-r')
  await withDbClient((db) => revokeApiKey(db, R.apiKey.id, script))
  check('revoked key → 401', (await api(R.key, 'GET', '')).status === 401)
  const E = await newKey('oauthtest-e')
  await query("update oauth_api_keys set expires_at = now() - interval '1 minute' where id = $1", [E.apiKey.id])
  check('expired key → 401', (await api(E.key, 'GET', '')).status === 401)
  check('a session cookie is not a key → 401', (await fetch(`${BASE}/api/oauth-clients`, { headers: { cookie: 'planner_session=whatever' } })).status === 401)

  // --- create, with approval
  const webId = `${A.prefix}web`
  const webUri = `https://${A.host}/auth/callback`
  const created = await api(A.key, 'POST', '', {
    client_id: webId, client_name: 'A web', redirect_uris: [webUri, 'http://localhost:5173/auth/callback'],
    roles: ['pupil', 'teacher'], scopes: ['profile'], audience: A.aud,
  })
  check('create → 201, pending approval', created.status === 201 && created.json.client.status === 'pending_approval', JSON.stringify(created.json))
  const stored = (await query<Json>('select first_party, token_format, owner_key_id, client_type from oauth_clients where client_id = $1', [webId])).rows[0]
  check('created as first-party JWT, owned by the key', stored?.first_party === true && stored.token_format === 'jwt' && stored.owner_key_id === A.apiKey.id && stored.client_type === 'public')
  const pendingCheck = await checkAuthorizeRequest(authParams(webId, webUri, pkce().challenge), ISS)
  check('pending client cannot sign anyone in', pendingCheck.status === 'invalid')
  check('the project cannot approve its own client → 403', (await api(A.key, 'POST', `/${webId}/enable`)).status === 403)
  await approve(webId)
  const teacher = await makeUser('teacher', ['teacher'])
  const signedIn = await exchange(webId, webUri, await codeFor(webId, webUri, teacher, 'profile'))
  check('approved client signs a teacher in', signedIn.status === 200, JSON.stringify(signedIn.json))
  const userJwt = signedIn.json!.access_token as string
  check('user token carries token_use user and aud = the client audience', decodeJwt(userJwt).token_use === 'user' && decodeJwt(userJwt).aud === A.aud)
  check('userinfo accepts the user token', (await userinfo(userJwt)).status === 200)

  // --- disable / enable by the project
  check('disable → 200', (await api(A.key, 'POST', `/${webId}/disable`)).json?.client?.status === 'disabled')
  check('disabled client: authorize refused', (await checkAuthorizeRequest(authParams(webId, webUri, pkce().challenge), ISS)).status === 'invalid')
  check('disabled client: refresh refused', (await refresh(webId, signedIn.json!.refresh_token)).json?.error === 'invalid_grant')
  check('disabled client: userinfo refused', (await userinfo(userJwt)).status === 401)
  check('enable after approval → 200', (await api(A.key, 'POST', `/${webId}/enable`)).json?.client?.status === 'enabled')

  // --- isolation: another project's client is 404
  const bWeb = `${B.prefix}web`
  const bCreated = await api(B.key, 'POST', '', { client_id: bWeb, client_name: 'B web', redirect_uris: [`https://${B.host}/cb`], roles: ['pupil'], audience: B.aud })
  check('key without approval creates an enabled client', bCreated.status === 201 && bCreated.json.client.status === 'enabled')
  await withDbClient((db) => setClientEnabled(db, script, bWeb, false))
  check('a client an admin disabled cannot be re-enabled by its project → 403', (await api(B.key, 'POST', `/${bWeb}/enable`)).status === 403)
  check('… nor after the project disables it too', (await api(B.key, 'POST', `/${bWeb}/disable`)).status === 200 && (await api(B.key, 'POST', `/${bWeb}/enable`)).status === 403)
  check('an admin can enable it again', (await approve(bWeb)).disabledAt === null && (await api(B.key, 'POST', `/${bWeb}/disable`)).status === 200 && (await api(B.key, 'POST', `/${bWeb}/enable`)).status === 200)
  check('B GET A\'s client → 404', (await api(B.key, 'GET', `/${webId}`)).status === 404)
  check('B PATCH A\'s client → 404', (await api(B.key, 'PATCH', `/${webId}`, { client_name: 'stolen' })).status === 404)
  check('B disable A\'s client → 404', (await api(B.key, 'POST', `/${webId}/disable`)).status === 404)
  check('B add a redirect URI to A\'s client → 404', (await api(B.key, 'POST', `/${webId}/redirect-uris`, { uri: `https://${B.host}/x` })).status === 404)
  const lists = await api(A.key, 'GET', '')
  check('list shows only own clients', lists.status === 200 && lists.json.clients.map((c: Json) => c.client_id).join() === webId, JSON.stringify(lists.json))
  check('A\'s client unchanged by B', (await query<Json>('select client_name, disabled_at from oauth_clients where client_id = $1', [webId])).rows[0].client_name === 'A web')
  const mcp = await (await fetch(`${BASE}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'oauthtest mcp', redirect_uris: ['http://localhost:4567/callback'] }) })).json()
  mcpClients.push(mcp.client_id)
  check('MCP (dynamic) client → 404 to a key', (await api(A.key, 'GET', `/${mcp.client_id}`)).status === 404
    && (await api(A.key, 'POST', `/${mcp.client_id}/disable`)).status === 404)
  check('kerf/admin-made client → 404 to a key', (await api(A.key, 'GET', '/kerf-editor')).status === 404)
  check('client_id already taken → 409', (await api(B.key, 'POST', '', { client_id: bWeb, client_name: 'again', redirect_uris: [`https://${B.host}/cb`], roles: ['pupil'], audience: B.aud })).status === 409)

  // --- ceiling: 403
  const base = { client_name: 'x', redirect_uris: [`https://${A.host}/cb`], roles: ['pupil'], audience: A.aud }
  const make = (over: Record<string, unknown>) => api(A.key, 'POST', '', { client_id: `${A.prefix}x`, ...base, ...over })
  check('role outside ceiling (admin) → 403', (await make({ roles: ['pupil', 'admin'] })).status === 403)
  check('client_id without the prefix → 403', (await make({ client_id: 'kerf-sneaky' })).status === 403)
  check('redirect host outside ceiling → 403', (await make({ redirect_uris: ['https://evil.test/cb'] })).status === 403)
  check('audience outside ceiling → 403', (await make({ audience: 'kerf-sabre' })).status === 403)
  check('service scope outside ceiling → 403', (await make({ client_type: 'service', redirect_uris: [], roles: [], audience: null, allowed_audiences: ['otsvc-target'], service_scopes: ['svc:write'] })).status === 403)
  check('service audience equal to a sign-in audience → 422', (await make({ client_type: 'service', redirect_uris: [], roles: [], audience: null, allowed_audiences: [A.aud] })).status === 422)
  // --- validation: 422
  check('http redirect on a real host → 422', (await make({ redirect_uris: [`http://${A.host}/cb`] })).status === 422)
  check('fragment → 422', (await make({ redirect_uris: [`https://${A.host}/cb#f`] })).status === 422)
  check('wildcard → 422', (await make({ redirect_uris: [`https://${A.host}/*`] })).status === 422)
  check('userinfo in URI → 422', (await make({ redirect_uris: [`https://u:p@${A.host}/cb`] })).status === 422)
  check('21 redirect URIs → 422', (await make({ redirect_uris: Array.from({ length: 21 }, (_, i) => `https://${A.host}/cb${i}`) })).status === 422)
  check('unknown body field (first_party) → 422', (await make({ first_party: false })).status === 422)
  check('owner_key_id cannot be set → 422', (await make({ owner_key_id: B.apiKey.id })).status === 422)
  check('malformed JSON → 422', (await api(A.key, 'POST', '', '{nope')).status === 422)
  check('PATCH a role outside ceiling → 403', (await api(A.key, 'PATCH', `/${webId}`, { roles: ['admin'] })).status === 403)
  const patched = await api(A.key, 'PATCH', `/${webId}`, { client_name: 'A web 2', scopes: ['profile', 'groups'], access_ttl_seconds: 600 })
  check('PATCH within ceiling → 200', patched.status === 200 && patched.json.client.client_name === 'A web 2' && patched.json.client.access_ttl_seconds === 600)

  // --- redirect URIs
  const added = await api(A.key, 'POST', `/${webId}/redirect-uris`, { uri: `https://${A.host}/second` })
  check('add redirect URI → 200', added.status === 200 && added.json.client.redirect_uris.includes(`https://${A.host}/second`))
  check('add a URI on another host → 403', (await api(A.key, 'POST', `/${webId}/redirect-uris`, { uri: 'https://evil.test/cb' })).status === 403)
  check('remove redirect URI → 200', (await api(A.key, 'DELETE', `/${webId}/redirect-uris`, { uri: `https://${A.host}/second` })).status === 200)
  await api(A.key, 'DELETE', `/${webId}/redirect-uris`, { uri: 'http://localhost:5173/auth/callback' })
  check('removing the last redirect URI → 422', (await api(A.key, 'DELETE', `/${webId}/redirect-uris`, { uri: webUri })).status === 422)

  // --- service clients and client_credentials
  const svcId = `${A.prefix}svc`
  const svc = await api(A.key, 'POST', '', { client_id: svcId, client_name: 'A sync', client_type: 'service', allowed_audiences: ['otsvc-target'], service_scopes: ['svc:read'] })
  const secret = svc.json?.client_secret as string
  secrets.push(secret)
  check('service client created; secret shown once (dino_cs_)', svc.status === 201 && /^dino_cs_[A-Za-z0-9_-]{43}$/.test(secret ?? ''), JSON.stringify(svc.json?.client))
  check('the secret is never shown again', !JSON.stringify((await api(A.key, 'GET', `/${svcId}`)).json).includes('dino_cs_'))
  check('only the secret hash is stored', (await query<Json>('select client_secret_hash from oauth_clients where client_id = $1', [svcId])).rows[0].client_secret_hash === sha256(secret))
  const pendingSvc = await serviceToken(svcId, secret)
  check('pending service client → invalid_client', pendingSvc.status === 401 && pendingSvc.json?.error === 'invalid_client')
  await approve(svcId)

  const st = await serviceToken(svcId, secret, { scope: 'svc:read' })
  check('client_credentials (Basic) → 200', st.status === 200, JSON.stringify(st.json))
  check('no refresh token; Bearer; 300 s', !('refresh_token' in (st.json ?? {})) && st.json?.token_type === 'Bearer' && st.json?.expires_in === 300)
  const jwks = createLocalJWKSet(await (await fetch(`${BASE}/oauth/jwks`)).json())
  const { payload, protectedHeader } = await jwtVerify(st.json!.access_token, jwks, { issuer: ISS, audience: 'otsvc-target', algorithms: ['RS256'], typ: 'at+jwt' })
  check('service JWT: RS256 at+jwt via JWKS, token_use service, sub = client_id, scope',
    protectedHeader.typ === 'at+jwt' && payload.token_use === 'service' && payload.sub === svcId && payload.client_id === svcId && payload.scope === 'svc:read'
    && payload.exp! - payload.iat! === 300 && !!payload.jti && payload.nbf === payload.iat)
  check('service JWT has no roles, groups or sid', !('roles' in payload) && !('groups' in payload) && !('sid' in payload))
  const post = await form('/oauth/token', { grant_type: 'client_credentials', client_id: svcId, client_secret: secret, resource: 'otsvc-target' })
  check('client_secret_post with resource → 200, no scope asked → none granted', post.status === 200 && post.json?.scope === '')
  const wrong = await serviceToken(svcId, `dino_cs_${'y'.repeat(43)}`)
  const unknown = await serviceToken(`${A.prefix}nobody`, secret)
  const fixed = await serviceToken(svcId, 'dino-no-such-service-client')
  check('the dummy-hash string is not a universal secret', fixed.status === 401 && fixed.json?.error === 'invalid_client')
  check('an empty-ish secret is refused', (await form('/oauth/token', { grant_type: 'client_credentials', audience: 'otsvc-target', client_id: svcId, client_secret: 'x' })).status === 401)
  check('wrong secret → 401 invalid_client', wrong.status === 401 && wrong.json?.error === 'invalid_client' && /^Basic/.test(wrong.headers.get('www-authenticate') ?? ''))
  check('unknown client → the same response', unknown.status === wrong.status && JSON.stringify(unknown.json) === JSON.stringify(wrong.json))
  const userClientAsService = await serviceToken(webId, secret)
  check('a sign-in client cannot use client_credentials', userClientAsService.status === 401 && JSON.stringify(userClientAsService.json) === JSON.stringify(wrong.json))
  check('disallowed audience → invalid_target', (await serviceToken(svcId, secret, { audience: 'kerf-sabre' })).json?.error === 'invalid_target')
  check('no audience → invalid_request', (await form('/oauth/token', { grant_type: 'client_credentials' }, basic(svcId, secret))).json?.error === 'invalid_request')
  check('disallowed scope → invalid_scope', (await serviceToken(svcId, secret, { scope: 'svc:write' })).json?.error === 'invalid_scope')
  check('Basic and client_secret together → invalid_request', (await form('/oauth/token', { grant_type: 'client_credentials', audience: 'otsvc-target', client_secret: secret }, basic(svcId, secret))).json?.error === 'invalid_request')
  check('no credentials → 401 invalid_client', (await form('/oauth/token', { grant_type: 'client_credentials', audience: 'otsvc-target' })).status === 401)

  // --- a service token is not a user token, and the reverse
  const serviceJwt = st.json!.access_token as string
  check('userinfo refuses a service token', (await userinfo(serviceJwt)).status === 401)
  check('verifyAccessJwt (user tokens) refuses a service token', (await verifyAccessJwt(serviceJwt, { issuer: ISS })) === null)
  check('/api/MCP refuses a service token', (await mcpCall(serviceJwt)).status === 401)
  check('verifyServiceJwt accepts the service token', (await verifyServiceJwt(serviceJwt, { issuer: ISS, audience: 'otsvc-target', allowedClients: [svcId] }))?.sub === svcId)
  check('verifyServiceJwt refuses a user token', (await verifyServiceJwt(userJwt, { issuer: ISS, audience: A.aud, allowedClients: [webId] })) === null)
  check('a service client cannot be used to sign in', (await checkAuthorizeRequest(authParams(svcId, webUri, pkce().challenge), ISS)).status === 'invalid')
  check('a service client cannot refresh', (await refresh(svcId, 'whatever')).json?.error === 'invalid_grant')

  // --- disabled service client, then secret rotation
  await api(A.key, 'POST', `/${svcId}/disable`)
  const disabled = await serviceToken(svcId, secret)
  check('disabled service client → same invalid_client', disabled.status === 401 && JSON.stringify(disabled.json) === JSON.stringify(wrong.json))
  await api(A.key, 'POST', `/${svcId}/enable`)
  const rot = await api(A.key, 'POST', `/${svcId}/rotate-secret`)
  const secret2 = rot.json?.client_secret as string
  secrets.push(secret2)
  check('rotate-secret → new secret once', rot.status === 200 && secret2 !== secret && /^dino_cs_/.test(secret2))
  check('no overlap: old secret stops at once', (await serviceToken(svcId, secret)).status === 401)
  check('new secret works', (await serviceToken(svcId, secret2)).status === 200)
  const rot2 = await api(A.key, 'POST', `/${svcId}/rotate-secret`, { overlap_seconds: 120 })
  const secret3 = rot2.json?.client_secret as string
  secrets.push(secret3)
  check('with overlap: old and new secrets both work', (await serviceToken(svcId, secret2)).status === 200 && (await serviceToken(svcId, secret3)).status === 200)
  check('rotate-secret on a sign-in client → 422', (await api(A.key, 'POST', `/${webId}/rotate-secret`)).status === 422)

  check('sign-in audience equal to a service audience → 422', (await api(B.key, 'POST', '', { client_id: `${B.prefix}clash`, client_name: 'clash', redirect_uris: [`https://${B.host}/cb`], roles: ['pupil'], audience: 'otsvc-target' })).status === 422)

  // --- max_clients (A owns web and svc; max 4)
  await api(A.key, 'POST', '', { ...base, client_id: `${A.prefix}three` })
  await api(A.key, 'POST', '', { ...base, client_id: `${A.prefix}four` })
  check('more than max_clients → 403', (await api(A.key, 'POST', '', { ...base, client_id: `${A.prefix}five` })).status === 403)

  // --- a key is not a user credential
  check('/api/MCP refuses a project key', (await mcpCall(A.key)).status === 401)
  check('userinfo refuses a project key', (await userinfo(A.key)).status === 401)

  // --- key rotation keeps the project's clients
  const rotated = await withDbClient((db) => rotateApiKey(db, A.apiKey.id, 0, script))
  secrets.push(rotated.key)
  check('rotated key works and still owns its clients', (await api(rotated.key, 'GET', '')).json?.clients?.length === 4)
  check('no overlap: old key → 401', (await api(A.key, 'GET', '')).status === 401)
  const rotatedAgain = await withDbClient((db) => rotateApiKey(db, A.apiKey.id, 120, script))
  secrets.push(rotatedAgain.key)
  check('with overlap: old and new key both work', (await api(rotated.key, 'GET', '')).status === 200 && (await api(rotatedAgain.key, 'GET', '')).status === 200)

  // --- rate limit
  await query(
    "insert into oauth_api_key_usage (key_id, window_start, request_count) values ($1, date_trunc('minute', now()), 60) on conflict (key_id, window_start) do update set request_count = 60",
    [B.apiKey.id],
  )
  const limited = await api(B.key, 'GET', '')
  check('over 60 requests a minute → 429 with Retry-After', limited.status === 429 && Number(limited.headers.get('retry-after')) > 0)
  await query('delete from oauth_api_key_usage where key_id = $1', [B.apiKey.id])
  check('last_used_at is stamped', (await query<Json>('select last_used_at from oauth_api_keys where id = $1', [B.apiKey.id])).rows[0].last_used_at !== null)

  // --- audit
  const audit = (await query<Json>(
    `select * from oauth_client_audit_log where key_name = any($1) or client_id like any(array['otoauthtest%', 'ota-%', 'otb-%'])`,
    [keyNames],
  )).rows
  const has = (action: string, outcome: string, status?: number) =>
    audit.some((a) => a.action === action && a.outcome === outcome && (status === undefined || a.status === status))
  check('audit: create ok, ceiling refusal 403, not-found 404, validation 422, rate limit 429',
    has('client.create', 'ok') && has('client.create', 'refused', 403) && has('client.read', 'refused', 404)
    && has('client.create', 'refused', 422) && has('client.list', 'refused', 429), `${audit.length} rows`)
  const uriChange = audit.find((a) => a.action === 'client.redirect_uri.add' && a.outcome === 'ok')
  check('audit: before/after of redirect URIs', !!uriChange && !uriChange.before.redirect_uris.includes(`https://${A.host}/second`) && uriChange.after.redirect_uris.includes(`https://${A.host}/second`))
  check('audit: key name and prefix recorded', audit.some((a) => a.key_name === 'oauthtest-a' && a.key_prefix?.length === 8))
  check('audit: key create/rotate/revoke recorded', has('key.create', 'ok') && has('key.rotate', 'ok') && has('key.revoke', 'ok'))
  const auditText = JSON.stringify(audit)
  check('audit contains no key, secret or hash', secrets.every((s) => !auditText.includes(s) && !auditText.includes(s.slice(8, 30)) && !auditText.includes(sha256(s)))
    && !auditText.includes('dino_cs_') && !auditText.includes('dino_pk_'))

  // --- discovery metadata
  const meta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json()
  check('metadata: client_credentials and secret auth methods added, "none" kept',
    meta.grant_types_supported.includes('client_credentials') && meta.grant_types_supported.includes('authorization_code')
    && ['none', 'client_secret_basic', 'client_secret_post'].every((m: string) => meta.token_endpoint_auth_methods_supported.includes(m)))
  check('dynamic registration still public, auth none', mcp.token_endpoint_auth_method === 'none'
    && (await query<Json>('select first_party, client_type from oauth_clients where client_id = $1', [mcp.client_id])).rows[0].first_party === false)
}

run(main, async () => {
  const ids = (await query<{ id: string }>('select id from oauth_api_keys where name = any($1)', [keyNames])).rows.map((r) => r.id)
  const owned = (await query<{ client_id: string }>('select client_id from oauth_clients where owner_key_id = any($1)', [ids])).rows.map((r) => r.client_id)
  await query('delete from oauth_clients where client_id = any($1)', [[...owned, ...mcpClients]])
  await query('delete from oauth_client_audit_log where api_key_id = any($1) or key_name = any($2) or client_id = any($3)', [ids, keyNames, owned])
  await query('delete from oauth_api_keys where id = any($1)', [ids])
  await deleteUsers()
})
