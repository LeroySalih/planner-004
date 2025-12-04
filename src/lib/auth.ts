import { randomBytes, randomUUID } from "node:crypto"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import bcrypt from "bcryptjs"

import { query } from "@/lib/db"

const SESSION_COOKIE = "planner_session"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days rolling
const BCRYPT_COST = 10

export type AuthenticatedProfile = {
  userId: string
  email: string | null
  isTeacher: boolean
  firstName?: string | null
  lastName?: string | null
}

type SessionRow = {
  session_id: string
  user_id: string
  token_hash: string
  expires_at: string
}

async function setSessionCookie(sessionId: string, token: string, expiresAt: Date) {
  const cookieStore = await cookies()
  cookieStore.set({
    name: SESSION_COOKIE,
    value: `${sessionId}.${token}`,
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    expires: expiresAt,
  })
}

async function clearSessionCookie() {
  // In RSC contexts (e.g. route handlers reading auth), cookie mutations are disallowed.
  // Swallow the write if Next.js rejects it; we still return the readable cookie state above.
  try {
    const cookieStore = await cookies()
    cookieStore.set({
      name: SESSION_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    })
  } catch {
    // Best-effort clear; ignore when cookies cannot be mutated in this context.
  }
}

function parseSessionCookie(raw: string | undefined | null) {
  if (!raw) return null
  const [sessionId, token] = raw.split(".")
  if (!sessionId || !token) return null
  return { sessionId, token }
}

async function refreshSession(sessionId: string, token: string) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await query(
    `update auth_sessions
     set expires_at = $1, last_active_at = now()
     where session_id = $2`,
    [expiresAt.toISOString(), sessionId],
  )
  // Only safe inside Server Actions / Route Handlers. Skip when called from RSCs.
  try {
    await setSessionCookie(sessionId, token, expiresAt)
  } catch {
    // Best-effort: DB expiry is refreshed even if cookie set is disallowed in this context.
  }
}

async function revokeSession(sessionId: string) {
  await query("delete from auth_sessions where session_id = $1", [sessionId])
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST)
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url")
  const tokenHash = await bcrypt.hash(token, BCRYPT_COST)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const headerList = await headers()
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  const userAgent = headerList.get("user-agent") ?? null

  const sessionId = randomUUID()
  await query(
    `insert into auth_sessions (session_id, user_id, token_hash, expires_at, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6)`,
    [sessionId, userId, tokenHash, expiresAt.toISOString(), ip, userAgent],
  )

  await setSessionCookie(sessionId, token, expiresAt)
  return { sessionId, token, expiresAt }
}

async function readProfile(userId: string): Promise<AuthenticatedProfile | null> {
  const { rows } = await query<{
    user_id: string
    email: string | null
    is_teacher: boolean | null
    first_name: string | null
    last_name: string | null
  }>(
    "select user_id, email, is_teacher, first_name, last_name from profiles where user_id = $1 limit 1",
    [userId],
  )

  const row = rows[0]
  if (!row) {
    return null
  }

  return {
    userId: row.user_id,
    email: row.email ?? null,
    isTeacher: Boolean(row.is_teacher),
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
  }
}

async function loadSessionProfile(refreshSessionCookie = false): Promise<AuthenticatedProfile | null> {
  const cookieStore = await cookies()
  const parsed = parseSessionCookie(cookieStore.get(SESSION_COOKIE)?.value ?? null)

  if (!parsed) {
    return null
  }

  const { sessionId, token } = parsed
  const { rows } = await query<SessionRow>(
    "select session_id, user_id, token_hash, expires_at from auth_sessions where session_id = $1 limit 1",
    [sessionId],
  )

  const session = rows[0]
  if (!session) {
    await clearSessionCookie()
    return null
  }

  const expiresAt = new Date(session.expires_at)
  const now = Date.now()
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) {
    await revokeSession(sessionId)
    await clearSessionCookie()
    return null
  }

  const matches = await bcrypt.compare(token, session.token_hash)
  if (!matches) {
    await revokeSession(sessionId)
    await clearSessionCookie()
    return null
  }

  if (refreshSessionCookie) {
    await refreshSession(sessionId, token)
  }

  const profile = await readProfile(session.user_id)
  if (!profile) {
    await revokeSession(sessionId)
    await clearSessionCookie()
    return null
  }

  return profile
}

export async function endSession() {
  const cookieStore = await cookies()
  const parsed = parseSessionCookie(cookieStore.get(SESSION_COOKIE)?.value ?? null)

  if (parsed?.sessionId) {
    await revokeSession(parsed.sessionId)
  }

  await clearSessionCookie()
}

export async function getAuthenticatedProfile(options?: { refreshSessionCookie?: boolean }): Promise<AuthenticatedProfile | null> {
  return loadSessionProfile(Boolean(options?.refreshSessionCookie))
}

export async function requireTeacherProfile(options?: { refreshSessionCookie?: boolean }): Promise<AuthenticatedProfile> {
  const profile = await getAuthenticatedProfile({ refreshSessionCookie: options?.refreshSessionCookie })

  if (!profile) {
    redirect("/signin")
  }

  if (!profile.isTeacher) {
    redirect("/profiles")
  }

  return profile
}

export async function requireAuthenticatedProfile(options?: { refreshSessionCookie?: boolean }): Promise<AuthenticatedProfile> {
  const profile = await getAuthenticatedProfile({ refreshSessionCookie: options?.refreshSessionCookie })

  if (!profile) {
    redirect("/signin")
  }

  return profile
}
