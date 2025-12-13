"use server"

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { cookies, headers } from "next/headers"
import { z } from "zod"

import { query } from "@/lib/db"
import {
  createSession,
  endSession,
  getAuthenticatedProfile,
  hashPassword,
  verifyPassword,
  type AuthenticatedProfile,
} from "@/lib/auth"
import { logPupilSignIn } from "@/lib/server-actions/pupil-sign-ins"
import { withTelemetry } from "@/lib/telemetry"

const SignupInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

const SigninInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  csrfToken: z.string().min(32),
})

const AuthResultSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
  userId: z.string().nullable(),
  isTeacher: z.boolean().nullable(),
})

type AuthResult = z.infer<typeof AuthResultSchema>

const CSRF_COOKIE_NAME = "planner_csrf_token"
const SIGNIN_WINDOW_MINUTES = 15
const SIGNIN_EMAIL_FAILURE_LIMIT = 5
const SIGNIN_IP_FAILURE_LIMIT = 25
type SigninThrottleResult = { blocked: boolean; reason: "email-limit" | "ip-limit" | null }

type SigninAttemptReason =
  | "invalid-payload"
  | "lookup-error"
  | "profile-not-found"
  | "invalid-password"
  | "throttled"
  | "csrf-mismatch"
  | "forbidden-origin"
  | "signup-email-exists"

function logSigninFailure(context: { email: string; reason: string }) {
  console.error("[auth] sign-in failed", context)
}

function hashEmailForLog(email: string) {
  // Non-reversible, short identifier to correlate duplicates without storing raw email.
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16)
}

function safeHostname(value: string) {
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return null
  }
}

async function recordSigninAttempt(input: {
  email: string
  ip: string | null
  userId: string | null
  success: boolean
  reason: SigninAttemptReason | null
}) {
  const { email, ip, userId, success, reason } = input
  try {
    await query(
      `
        insert into sign_in_attempts (email, ip, user_id, success, reason)
        values ($1, $2, $3, $4, $5)
      `,
      [email.toLowerCase(), ip, userId, success, reason],
    )
  } catch (error) {
    console.error("[auth] Failed to record sign-in attempt", { email, ip, success, reason, error })
  }
}

async function isSigninThrottled(params: { email: string; ip: string | null }): Promise<SigninThrottleResult> {
  try {
    const { email, ip } = params
    const { rows: emailRows } = await query<{ count: number }>(
      `
        select count(*)::int as count
        from sign_in_attempts
        where success = false
          and lower(email) = lower($1)
          and attempted_at >= now() - ($2::int * interval '1 minute')
      `,
      [email, SIGNIN_WINDOW_MINUTES],
    )

    const emailFailures = emailRows[0]?.count ?? 0
    if (emailFailures >= SIGNIN_EMAIL_FAILURE_LIMIT) {
      return { blocked: true, reason: "email-limit" }
    }

    if (!ip) {
      return { blocked: false, reason: null }
    }

    const { rows: ipRows } = await query<{ count: number }>(
      `
        select count(*)::int as count
        from sign_in_attempts
        where success = false
          and ip = $1
          and attempted_at >= now() - ($2::int * interval '1 minute')
      `,
      [ip, SIGNIN_WINDOW_MINUTES],
    )

    const ipFailures = ipRows[0]?.count ?? 0
    if (ipFailures >= SIGNIN_IP_FAILURE_LIMIT) {
      return { blocked: true, reason: "ip-limit" }
    }

    return { blocked: false, reason: null }
  } catch (error) {
    console.error("[auth] Failed to evaluate sign-in throttle", { error })
    return { blocked: false, reason: null }
  }
}

function isSchemaMissingError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const message = "message" in error && typeof (error as { message?: string }).message === "string"
    ? (error as { message: string }).message
    : ""
  return (
    message.includes('column "email" does not exist') ||
    message.includes('relation "auth_sessions" does not exist')
  )
}

async function findProfileByEmail(email: string) {
  try {
    const { rows } = await query<{
      user_id: string
      email: string | null
      password_hash: string | null
      is_teacher: boolean | null
      first_name: string | null
      last_name: string | null
    }>(
      `
        select user_id, email, password_hash, is_teacher, first_name, last_name
        from profiles
        where lower(email) = lower($1)
        limit 1
      `,
      [email],
    )

    return rows[0] ?? null
  } catch (error) {
    if (isSchemaMissingError(error)) {
      throw new Error(
        "Auth schema missing required columns/tables. Run migrations/2025-11-29-auth.sql.",
      )
    }
    throw error
  }
}

export async function signupAction(input: unknown): Promise<AuthResult> {
  const parsed = SignupInputSchema.safeParse(input)
  if (!parsed.success) {
    const [firstError] = parsed.error.issues
    return AuthResultSchema.parse({
      success: false,
      error: firstError?.message ?? "Invalid signup payload.",
      userId: null,
      isTeacher: null,
    })
  }

  const { password } = parsed.data
  const email = parsed.data.email.trim().toLowerCase()

  const genericSignupError = AuthResultSchema.parse({
    success: false,
    error: "We couldn’t create your account. Please try again later.",
    userId: null,
    isTeacher: null,
  })

  return withTelemetry(
    {
      routeTag: "/auth:signup",
      functionName: "signupAction",
      params: { email },
      authEndTime: null,
    },
    async () => {
      const existing = await findProfileByEmail(email)
      if (existing?.user_id) {
        console.warn("[auth] signup rejected - email exists", { emailHash: hashEmailForLog(email) })
        return genericSignupError
      }

      const userId = randomUUID()
      const passwordHash = await hashPassword(password)

      try {
        await query(
          `
            insert into profiles (user_id, email, password_hash, is_teacher)
            values ($1, $2, $3, false)
          `,
          [userId, email, passwordHash],
        )
      } catch (error) {
        if (isSchemaMissingError(error)) {
        return AuthResultSchema.parse({
          success: false,
          error: "Auth schema not upgraded. Please run migrations/2025-11-29-auth.sql.",
          userId: null,
          isTeacher: null,
        })
      }
      console.error("[auth] Failed to create profile for signup", { emailHash: hashEmailForLog(email), error })
      return genericSignupError
    }

      await createSession(userId)

      return AuthResultSchema.parse({
        success: true,
        error: null,
        userId,
        isTeacher: false,
      })
    },
  )
}

export async function issueSigninCsrfTokenAction(): Promise<{ token: string }> {
  const cookieStore = await cookies()
  const existing = cookieStore.get(CSRF_COOKIE_NAME)?.value
  const token = existing ?? randomBytes(32).toString("hex")

  cookieStore.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    secure: true,
    path: "/",
  })

  return { token }
}

export async function signinAction(input: unknown): Promise<AuthResult> {
  const parsed = SigninInputSchema.safeParse(input)
  if (!parsed.success) {
    const rawEmail =
      typeof (input as { email?: unknown })?.email === "string"
        ? (input as { email: string }).email
        : "unknown"
    logSigninFailure({ email: rawEmail, reason: "invalid-payload" })
    const [firstError] = parsed.error.issues
    return AuthResultSchema.parse({
      success: false,
      error: firstError?.message ?? "Invalid sign-in payload.",
      userId: null,
      isTeacher: null,
    })
  }

  const { password, csrfToken } = parsed.data
  const email = parsed.data.email.trim().toLowerCase()
  const cookieStore = await cookies()
  const csrfCookie = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? ""
  const csrfMatches =
    csrfCookie &&
    csrfToken &&
    Buffer.byteLength(csrfCookie) === Buffer.byteLength(csrfToken) &&
    timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfToken))

  const headerList = await headers()
  const origin = headerList.get("origin")
  const referer = headerList.get("referer")
  const host = headerList.get("host")
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null

  const allowedHosts = new Set(
    [
      host,
      process.env.NEXT_PUBLIC_APP_URL ? safeHostname(process.env.NEXT_PUBLIC_APP_URL) : null,
      process.env.APP_URL ? safeHostname(process.env.APP_URL) : null,
    ]
      .filter(Boolean)
      .map((value) => value!.toLowerCase()),
  )

  const originHost = origin ? safeHostname(origin) : null
  const refererHost = referer ? safeHostname(referer) : null
  const hasAllowedOrigin =
    (originHost && allowedHosts.has(originHost)) || (refererHost && allowedHosts.has(refererHost))

  if (!csrfMatches || !hasAllowedOrigin) {
    logSigninFailure({
      email,
      reason: !csrfMatches ? "csrf-mismatch" : "forbidden-origin",
    })
    await recordSigninAttempt({
      email,
      ip,
      userId: null,
      success: false,
      reason: !csrfMatches ? "csrf-mismatch" : "forbidden-origin",
    })
    return AuthResultSchema.parse({
      success: false,
      error: "Unable to sign you in right now.",
      userId: null,
      isTeacher: null,
    })
  }

  return withTelemetry(
    {
      routeTag: "/auth:signin",
      functionName: "signinAction",
      params: { email },
      authEndTime: null,
    },
    async () => {
      const throttle = await isSigninThrottled({ email, ip })
      if (throttle.blocked) {
        logSigninFailure({ email, reason: "throttled" })
        await recordSigninAttempt({
          email,
          ip,
          userId: null,
          success: false,
          reason: "throttled",
        })
        return AuthResultSchema.parse({
          success: false,
          error: "Too many sign-in attempts. Please wait a few minutes and try again.",
          userId: null,
          isTeacher: null,
        })
      }

      let profile: Awaited<ReturnType<typeof findProfileByEmail>>
      try {
        profile = await findProfileByEmail(email)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to look up your account right now."
        logSigninFailure({ email, reason: "lookup-error" })
        await recordSigninAttempt({ email, ip, userId: null, success: false, reason: "lookup-error" })
        return AuthResultSchema.parse({
          success: false,
          error: message,
          userId: null,
          isTeacher: null,
        })
      }

      if (!profile?.user_id || !profile.password_hash) {
        logSigninFailure({ email, reason: "profile-not-found" })
        await recordSigninAttempt({
          email,
          ip,
          userId: null,
          success: false,
          reason: "profile-not-found",
        })
        return AuthResultSchema.parse({
          success: false,
          error: "Invalid email or password.",
          userId: null,
          isTeacher: null,
        })
      }

      const matches = await verifyPassword(password, profile.password_hash)
      if (!matches) {
        logSigninFailure({ email, reason: "invalid-password" })
        await recordSigninAttempt({
          email,
          ip,
          userId: profile.user_id,
          success: false,
          reason: "invalid-password",
        })
        return AuthResultSchema.parse({
          success: false,
          error: "Invalid email or password.",
          userId: null,
          isTeacher: null,
        })
      }

      await createSession(profile.user_id)
      console.info("[auth] sign-in success", { email, userId: profile.user_id, isTeacher: Boolean(profile.is_teacher) })
      await recordSigninAttempt({ email, ip, userId: profile.user_id, success: true, reason: null })
      if (!profile.is_teacher) {
        const url = headerList.get("referer") ?? "/signin"
        await logPupilSignIn({ pupilId: profile.user_id, url })
      }

      return AuthResultSchema.parse({
        success: true,
        error: null,
        userId: profile.user_id,
        isTeacher: Boolean(profile.is_teacher),
      })
    },
  )
}

export async function signoutAction(): Promise<{ success: boolean }> {
  await withTelemetry(
    {
      routeTag: "/auth:signout",
      functionName: "signoutAction",
      params: {},
      authEndTime: null,
    },
    async () => {
      await endSession()
    },
  )

  return { success: true }
}

export async function getSessionProfileAction(): Promise<AuthenticatedProfile | null> {
  return getAuthenticatedProfile()
}
