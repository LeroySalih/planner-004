import { cookies } from "next/headers"

import { createServerClient } from "@supabase/ssr"

const supabaseUrlEnv =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_SUPABASE_URL ?? process.env.SUPABASE_URL
const supabaseKeyEnv =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY

if (!supabaseUrlEnv || !supabaseKeyEnv) {
  throw new Error("Supabase environment variables are not configured")
}

const SUPABASE_URL = supabaseUrlEnv as string
const SUPABASE_KEY = supabaseKeyEnv as string

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
