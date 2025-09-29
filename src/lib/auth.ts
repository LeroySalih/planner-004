import { redirect } from "next/navigation"

import { createSupabaseServerClient } from "@/lib/supabase/server"

type AuthenticatedProfile = {
  userId: string
  isTeacher: boolean
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
