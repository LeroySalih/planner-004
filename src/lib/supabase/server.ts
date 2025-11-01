import { cookies } from "next/headers"

import { createServerClient } from "@supabase/ssr"

const supabaseUrlEnv =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_SUPABASE_URL ?? process.env.SUPABASE_URL
const supabaseKeyEnv =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY
const serviceRoleKeyEnv = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null

if (!supabaseUrlEnv || !supabaseKeyEnv) {
  throw new Error("Supabase environment variables are not configured")
}

const SUPABASE_URL = supabaseUrlEnv as string
const SUPABASE_KEY = supabaseKeyEnv as string
const SUPABASE_SERVICE_KEY = serviceRoleKeyEnv ?? undefined

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
      set() {
        // Server Components cannot modify cookies; ignore
      },
      remove() {
        // Server Components cannot modify cookies; ignore
      },
    },
  })
}

export function createSupabaseServiceClient() {
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured")
  }

  return createServerClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    cookies: {
      get() {
        return undefined
      },
      set() {
        // Service client does not manage cookies
      },
      remove() {
        // Service client does not manage cookies
      },
    },
  })
}
