"use server"

import { randomUUID } from "node:crypto"
import { z } from "zod"
import { headers } from "next/headers"

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
})

const AuthResultSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
  userId: z.string().nullable(),
  isTeacher: z.boolean().nullable(),
})

type AuthResult = z.infer<typeof AuthResultSchema>

function logSigninFailure(context: { email: string; reason: string }) {
  console.error("[auth] sign-in failed", context)
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
        return AuthResultSchema.parse({
          success: false,
          error: "An account already exists for that email.",
          userId: null,
        })
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
      console.error("[auth] Failed to create profile for signup", { email, error })
      return AuthResultSchema.parse({
        success: false,
        error: "Unable to create your account.",
        userId: null,
        isTeacher: null,
      })
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

  const { password } = parsed.data
  const email = parsed.data.email.trim().toLowerCase()

  return withTelemetry(
    {
      routeTag: "/auth:signin",
      functionName: "signinAction",
      params: { email },
      authEndTime: null,
    },
    async () => {
      let profile: Awaited<ReturnType<typeof findProfileByEmail>>
      try {
        profile = await findProfileByEmail(email)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to look up your account right now."
        logSigninFailure({ email, reason: "lookup-error" })
        return AuthResultSchema.parse({
          success: false,
          error: message,
          userId: null,
          isTeacher: null,
        })
      }

      if (!profile?.user_id || !profile.password_hash) {
        logSigninFailure({ email, reason: "profile-not-found" })
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
        return AuthResultSchema.parse({
          success: false,
          error: "Invalid email or password.",
          userId: null,
          isTeacher: null,
        })
      }

      await createSession(profile.user_id)
      console.info("[auth] sign-in success", { email, userId: profile.user_id, isTeacher: Boolean(profile.is_teacher) })
      if (!profile.is_teacher) {
        const headerList = await headers()
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
