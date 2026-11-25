import type { NextRequest, NextResponse } from "next/server"

// Edge-safe: middleware imports it.
//
// A session lasts SESSION_TTL_MS from the last activity, in the database
// (auth_sessions.expires_at, the authority) and in the browser (the cookie's
// expiry). Both used to be set only at sign-in, so everyone was signed out an
// hour after signing in however active they were. Now:
// - loadSessionProfile (auth.ts) extends the database row once it is older than
//   SESSION_REFRESH_AFTER_MS, and sets the cookie where Next.js allows it
//   (server actions, route handlers);
// - middleware extends the cookie on every GET, which covers page loads, where
//   a server component cannot set cookies.

export const SESSION_COOKIE = "planner_session"
export const SESSION_TTL_MS = 60 * 60 * 1000
export const SESSION_REFRESH_AFTER_MS = 5 * 60 * 1000

const COOKIE_SECURE = process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_APP_URL?.startsWith("http://")

export function sessionCookieOptions(expires: Date) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "strict" as const,
    secure: COOKIE_SECURE,
    path: "/",
    expires,
  }
}

/** True once the row was last extended more than SESSION_REFRESH_AFTER_MS ago. */
export function sessionNeedsRefresh(expiresAt: Date, now = Date.now()): boolean {
  return expiresAt.getTime() - now < SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS
}

// Page loads are server components, which cannot set cookies, so the browser's
// copy of the session cookie is extended here, from middleware. GET only:
// sign-in and sign-out are server actions (POST) that set the cookie
// themselves, and must not race this. The database row stays the authority: a
// cookie kept alive here for a session that has ended still signs nobody in.
export function extendSessionCookie(request: NextRequest, response: NextResponse) {
  if (request.method !== "GET") return
  const value = request.cookies.get(SESSION_COOKIE)?.value
  if (!value) return
  response.cookies.set({ ...sessionCookieOptions(new Date(Date.now() + SESSION_TTL_MS)), value })
}
