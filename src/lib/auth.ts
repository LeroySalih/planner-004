import { randomBytes, randomUUID } from "node:crypto"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import bcrypt from "bcryptjs"

import { query } from "@/lib/db"

const SESSION_COOKIE = "planner_session"
const SESSION_TTL_MS = 60 * 60 * 1000 // 1 hour rolling
const BCRYPT_COST = 10

export type AuthenticatedProfile = {
  userId: string
  email: string | null
  isTeacher: boolean // Deprecated: use hasRole(profile, 'teacher')
  roles: string[]
  firstName?: string | null
  lastName?: string | null
}

type SessionRow = {
  session_id: string
  user_id: string
  token_hash: string
  expires_at: string
  ip: string | null
  user_agent: string | null
}

export function hasRole(profile: AuthenticatedProfile | null, role: string): boolean {
  if (!profile) return false
  return profile.roles.includes(role)
}

async function buildSigninRedirect(): Promise<string> {
  const headerList = await headers()
  const pathname = headerList.get("x-pathname")
  if (pathname && pathname !== "/signin" && pathname !== "/" && pathname.startsWith("/") && !pathname.startsWith("//")) {
    return `/signin?returnTo=${encodeURIComponent(pathname)}`
  }
  return "/signin"
}

export async function requireRole(role: string, options?: { refreshSessionCookie?: boolean }): Promise<AuthenticatedProfile> {
  const profile = await getAuthenticatedProfile({ refreshSessionCookie: options?.refreshSessionCookie })

  if (!profile) {
    redirect(await buildSigninRedirect())
  }

  if (!hasRole(profile, role)) {
    // If user is logged in but doesn't have the required role, redirect to a safe default
    // or arguably an "unauthorized" page. For now, profiles dashboard is a safe bet.
    redirect("/profiles")
  }

  return profile
}

const COOKIE_SECURE = process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_APP_URL?.startsWith("http://")

async function setSessionCookie(sessionId: string, token: string, expiresAt: Date) {
  const cookieStore = await cookies()
  cookieStore.set({
    name: SESSION_COOKIE,
    value: `${sessionId}.${token}`,
    httpOnly: true,
    sameSite: "strict",
    secure: COOKIE_SECURE,
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
      sameSite: "strict",
      secure: COOKIE_SECURE,
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
  // Fetch profile and roles in one go
  const { rows } = await query<{
    user_id: string
    email: string | null
    is_teacher: boolean | null
    first_name: string | null
    last_name: string | null
    roles: string[] | null
  }>(
    `
      select p.user_id, p.email, p.is_teacher, p.first_name, p.last_name,
             array_agg(ur.role_id) filter (where ur.role_id is not null) as roles
      from profiles p
      left join user_roles ur on ur.user_id = p.user_id
      where p.user_id = $1
      group by p.user_id
      limit 1
    `,
    [userId],
  )

  const row = rows[0]
  if (!row) {
    return null
  }

  const roles = row.roles ?? []
  
  // Backward compatibility: If no roles in DB but is_teacher is set, treat as teacher.
  // Although migration should have fixed this, it's a safe fallback.
  const isTeacherFlag = Boolean(row.is_teacher)
  if (isTeacherFlag && !roles.includes("teacher")) {
    roles.push("teacher")
  }
  
  // Default to 'pupil' if no roles found (safe default)
  if (roles.length === 0) {
    roles.push("pupil")
  }

  return {
    userId: row.user_id,
    email: row.email ?? null,
    isTeacher: roles.includes("teacher"), // Computed from roles now
    roles: roles,
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
    `
      select session_id, user_id, token_hash, expires_at, ip, user_agent
      from auth_sessions
      where session_id = $1
      limit 1
    `,
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
  const headerList = await headers()
  const requestIp = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  const requestUserAgent = headerList.get("user-agent") ?? null
  const ipMatches = !session.ip || session.ip === requestIp
  const userAgentMatches = !session.user_agent || session.user_agent === requestUserAgent

  if (!matches) {
    await revokeSession(sessionId)
    await clearSessionCookie()
    return null
  }

  if (!ipMatches || !userAgentMatches) {
    console.warn("[auth] Session IP/UA mismatch (allowing for now)", {
      sessionId,
      expectedIp: session.ip,
      requestIp,
      expectedUa: session.user_agent,
      requestUa: requestUserAgent,
    })
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

export async function getProfileFromSessionCookie(
  rawSessionCookie: string | undefined | null,
): Promise<AuthenticatedProfile | null> {
  const parsed = parseSessionCookie(rawSessionCookie ?? null)
  if (!parsed) {
    return null
  }

  const { rows } = await query<SessionRow>(
    `
      select session_id, user_id, token_hash, expires_at, ip, user_agent
      from auth_sessions
      where session_id = $1
      limit 1
    `,
    [parsed.sessionId],
  )

  const session = rows[0]
  if (!session) {
    return null
  }

  const expiresAt = new Date(session.expires_at)
  const now = Date.now()
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) {
    return null
  }

  const matches = await bcrypt.compare(parsed.token, session.token_hash)
  const ipMatches = !session.ip
  const userAgentMatches = !session.user_agent
  
  if (!matches) {
    return null
  }

  // Relaxed check: Log warning but don't fail for IP/UA mismatch in this context either
  if (!ipMatches || !userAgentMatches) {
    // We don't have easy access to request headers here to log comparison, 
    // but we proceed if token matches.
  }

  return readProfile(session.user_id)
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
  return requireRole('teacher', options)
}

export async function requireAuthenticatedProfile(options?: { refreshSessionCookie?: boolean }): Promise<AuthenticatedProfile> {
  const profile = await getAuthenticatedProfile({ refreshSessionCookie: options?.refreshSessionCookie })

  if (!profile) {
    redirect(await buildSigninRedirect())
  }

  return profile
}
