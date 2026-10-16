import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { checkAuthorizeRequest, issueAuthorizationCode } from '@/lib/oauth/server'

// Shared by the OAuth checks (tests/oauth/README.md). They run with tsx
// against a dev database and a running dev server, never production.

export const BASE = (process.env.OAUTH_TEST_BASE ?? 'http://localhost:3000').replace(/\/$/, '')

let failures = 0
export const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail && !ok ? ` — ${detail}` : ''}`)
}

/** Runs `main`, then `cleanup` whatever happened, and exits non-zero on any failure. */
export function run(main: () => Promise<void>, cleanup: () => Promise<void>) {
  main()
    .catch((error) => {
      failures++
      console.error(error)
    })
    .finally(async () => {
      try {
        await cleanup()
      } catch (error) {
        failures++
        console.error('cleanup failed', error)
      }
      console.log(failures ? `${failures} FAILED` : 'ALL PASS')
      process.exit(failures ? 1 : 0)
    })
}

export const users: string[] = []

export async function makeUser(label: string, roles: string[], opts: { isTeacher?: boolean } = {}) {
  const id = randomUUID()
  await query(`insert into profiles (user_id, email, first_name, last_name, is_teacher) values ($1, $2, 'Test', $3, $4)`, [
    id,
    `oauthtest-${label}-${id.slice(0, 8)}@example.invalid`,
    label,
    opts.isTeacher ?? false,
  ])
  for (const role of roles) await query('insert into user_roles (user_id, role_id) values ($1, $2)', [id, role])
  users.push(id)
  return id
}

export async function deleteUsers() {
  if (!users.length) return
  await query('delete from group_membership where user_id = any($1)', [users])
  await query('delete from profiles where user_id = any($1)', [users])
}

export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export const authParams = (clientId: string, redirectUri: string, challenge: string, scope?: string) => ({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirectUri,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state: 'st',
  ...(scope !== undefined ? { scope } : {}),
})

let origin = ''
export async function issuer(): Promise<string> {
  if (!origin) origin = (await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json()).issuer
  return origin
}

/** Approves an authorize request as `userId`, as the authorize page does once they are signed in. */
export async function codeFor(clientId: string, redirectUri: string, userId: string, scope?: string) {
  const p = pkce()
  const c = await checkAuthorizeRequest(authParams(clientId, redirectUri, p.challenge, scope), await issuer())
  if (c.status !== 'ok') throw new Error(`authorize check failed: ${JSON.stringify(c)}`)
  const url = new URL(await issueAuthorizationCode(c.request, userId))
  return { code: url.searchParams.get('code')!, state: url.searchParams.get('state'), verifier: p.verifier, request: c.request }
}

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const form = async (path: string, body: Record<string, string>, headers: Record<string, string> = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body),
  })
  return { status: r.status, json: (await r.json().catch(() => null)) as Json | null, headers: r.headers }
}

export const exchange = (clientId: string, redirectUri: string, c: { code: string; verifier: string }) =>
  form('/oauth/token', { grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code: c.code, code_verifier: c.verifier })

export const refresh = (clientId: string, refreshToken: string) =>
  form('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken })

export const userinfo = async (token: string) => {
  const r = await fetch(`${BASE}/oauth/userinfo`, { headers: { authorization: `Bearer ${token}` } })
  return { status: r.status, json: (await r.json()) as Json, www: r.headers.get('www-authenticate') }
}

export const mcpCall = (auth: string) =>
  fetch(`${BASE}/api/MCP`, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
