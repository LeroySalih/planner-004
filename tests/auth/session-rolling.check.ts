import { NextRequest, NextResponse } from 'next/server'

import {
  SESSION_COOKIE,
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_MS,
  extendSessionCookie,
  sessionNeedsRefresh,
} from '@/lib/session-cookie'

// The rolling session (src/lib/session-cookie.ts): when the database row is
// extended, and the middleware's extension of the browser cookie. No database.
// Run: npx tsx tests/auth/session-rolling.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const MIN = 60 * 1000
const now = Date.now()
const at = (msFromNow: number) => new Date(now + msFromNow)

// --- The database row --------------------------------------------------------
check('just signed in: no write', !sessionNeedsRefresh(at(SESSION_TTL_MS), now))
check('extended under 5 minutes ago: no write', !sessionNeedsRefresh(at(SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS + MIN), now))
check('extended over 5 minutes ago: extended', sessionNeedsRefresh(at(SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS - MIN), now))
check('a minute before the hour ends: extended', sessionNeedsRefresh(at(MIN), now))

// --- The browser cookie (middleware) -----------------------------------------
const VALUE = 'session-id.token'
function run(method: string, cookie: string | null) {
  const headers = new Headers()
  if (cookie) headers.set('cookie', `${SESSION_COOKIE}=${cookie}; other=1`)
  const request = new NextRequest('https://dino.example.test/lessons/x', { method, headers })
  const response = NextResponse.next()
  extendSessionCookie(request, response)
  return response.headers.get('set-cookie')
}

const set = run('GET', VALUE)
check('GET with a session: cookie set again', Boolean(set?.startsWith(`${SESSION_COOKIE}=${VALUE}`)), String(set))
const expires = Date.parse(/Expires=([^;]+)/i.exec(set ?? '')?.[1] ?? '')
check('…an hour from now', Math.abs(expires - (Date.now() + SESSION_TTL_MS)) < 5000, String(expires))
check('…same flags as sign-in', /HttpOnly/i.test(set ?? '') && /SameSite=strict/i.test(set ?? '') && /Path=\//.test(set ?? ''))
check('GET without a session: nothing set', run('GET', null) === null)
check('POST (sign-in, sign-out, actions): nothing set', run('POST', VALUE) === null)

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
