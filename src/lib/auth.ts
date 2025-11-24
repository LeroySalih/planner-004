import { redirect } from "next/navigation"

import { createSupabaseServerClient } from "@/lib/supabase/server"

export type AuthenticatedProfile = {
  userId: string
  isTeacher: boolean
}

async function ensureProfileExists(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string) {
  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle()

  if (profileError && profileError.code !== "PGRST116") {
    console.error("Failed to verify profile existence", profileError)
    return
  }

  if (profileData) {
    return
  }

  const { error: upsertError } = await supabase
    .from("profiles")
    .upsert(
      {
        user_id: userId,
        first_name: "",
        last_name: "",
        is_teacher: false,
      },
      { onConflict: "user_id" },
    )

  if (upsertError) {
    console.error("Failed to auto-create profile", upsertError)
  }
}

export async function getAuthenticatedProfile(): Promise<AuthenticatedProfile | null> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    console.error("Failed to load auth session", userError)
    return null
  }

  if (!user) {
    return null
  }

  await ensureProfileExists(supabase, user.id)

  const { data, error: profileError } = await supabase
    .from("profiles")
    .select("is_teacher")
    .eq("user_id", user.id)
    .maybeSingle()

  if (profileError) {
    console.error("Failed to load profile", profileError)
    return { userId: user.id, isTeacher: false }
  }


  return {
    userId: user.id,
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

export async function requireAuthenticatedProfile(): Promise<AuthenticatedProfile> {
  const profile = await getAuthenticatedProfile()

  if (!profile) {
    redirect("/signin")
  }

  return profile
}
