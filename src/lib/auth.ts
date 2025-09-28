import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { supabaseServer } from "@/lib/supabaseClient"

type AuthenticatedProfile = {
  userId: string
  isTeacher: boolean
}

function parseAccessToken(value: string | undefined): string | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value)
    if (typeof parsed?.access_token === "string") {
      return parsed.access_token
    }
  } catch {
    return value
  }

  return null
}

function getAccessTokenFromCookies(): string | null {
  const store = cookies()
  const direct = store.get("sb-access-token")?.value
  const directToken = parseAccessToken(direct)
  if (directToken) {
    return directToken
  }

  for (const cookie of store.getAll()) {
    if (cookie.name.includes("auth-token") || cookie.name.includes("access-token")) {
      const token = parseAccessToken(cookie.value)
      if (token) {
        return token
      }
    }
  }

  return null
}

function decodeJwt(token: string): { sub?: string } | null {
  try {
    const segments = token.split(".")
    if (segments.length < 2) return null
    const segment = segments[1]
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    const payload = Buffer.from(padded, "base64").toString("utf8")
    return JSON.parse(payload)
  } catch (error) {
    console.error("Failed to decode JWT", error)
    return null
  }
}

export async function getAuthenticatedProfile(): Promise<AuthenticatedProfile | null> {
  const token = getAccessTokenFromCookies()
  if (!token) {
    return null
  }

  const payload = decodeJwt(token)
  const userId = payload?.sub
  if (!userId) {
    return null
  }

  const { data, error } = await supabaseServer
    .from("profiles")
    .select("is_teacher")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    console.error("Failed to load profile", error)
    return { userId, isTeacher: false }
  }

  return {
    userId,
    isTeacher: Boolean(data?.is_teacher),
  }
}

export async function requireTeacherProfile(): Promise<AuthenticatedProfile> {
  const profile = await getAuthenticatedProfile()

  if (!profile) {
    redirect("/signin")
  }

  if (!profile.isTeacher) {
    redirect("/profiles")
  }

  return profile
}
