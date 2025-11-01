"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { CurrentProfileSchema } from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireAuthenticatedProfile } from "@/lib/auth"

const ReadCurrentProfileResultSchema = z.object({
  data: CurrentProfileSchema.nullable(),
  error: z.string().nullable(),
})

export type ReadCurrentProfileResult = z.infer<typeof ReadCurrentProfileResultSchema>
export type ReadProfileDetailResult = ReadCurrentProfileResult

const ProfileIdSchema = z.object({
  profileId: z.string().min(1, "Profile identifier is required."),
})

export async function readCurrentProfileAction(): Promise<ReadCurrentProfileResult> {
  const authProfile = await requireAuthenticatedProfile()
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    console.error("[profile] Failed to load authenticated user", userError)
    return ReadCurrentProfileResultSchema.parse({
      data: null,
      error: "Unable to load your profile at the moment. Please try again shortly.",
    })
  }

  if (!user) {
    return ReadCurrentProfileResultSchema.parse({
      data: null,
      error: "You must be signed in to view your profile.",
    })
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, first_name, last_name, is_teacher")
    .eq("user_id", authProfile.userId)
    .maybeSingle()

  if (profileError && profileError.code !== "PGRST116") {
    console.error("[profile] Failed to read profile row", profileError)
  }

  const profile = CurrentProfileSchema.parse({
    user_id: authProfile.userId,
    email: user.email ?? null,
    first_name: profileRow?.first_name ?? null,
    last_name: profileRow?.last_name ?? null,
    is_teacher: Boolean(profileRow?.is_teacher ?? authProfile.isTeacher),
  })

  return ReadCurrentProfileResultSchema.parse({
    data: profile,
    error: null,
  })
}

const ProfileNameInputSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required.")
    .max(120, "First name must be 120 characters or fewer."),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required.")
    .max(120, "Last name must be 120 characters or fewer."),
})

const UpdateCurrentProfileInputSchema = ProfileNameInputSchema

const UpdateCurrentProfileResultSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
  data: CurrentProfileSchema.nullable(),
})

export type UpdateCurrentProfileInput = z.infer<typeof UpdateCurrentProfileInputSchema>
export type UpdateCurrentProfileResult = z.infer<typeof UpdateCurrentProfileResultSchema>
export type UpdateProfileDetailInput = UpdateCurrentProfileInput & { profileId: string }
export type UpdateProfileDetailResult = UpdateCurrentProfileResult

const UpdateProfileDetailInputSchema = ProfileNameInputSchema.extend({
  profileId: z.string().min(1, "Profile identifier is required."),
})

export async function updateCurrentProfileAction(
  input: UpdateCurrentProfileInput,
): Promise<UpdateCurrentProfileResult> {
  const parsed = UpdateCurrentProfileInputSchema.safeParse(input)

  if (!parsed.success) {
    const [firstError] = parsed.error.issues
    return UpdateCurrentProfileResultSchema.parse({
      success: false,
      error: firstError?.message ?? "Invalid profile details provided.",
      data: null,
    })
  }

  const authProfile = await requireAuthenticatedProfile()
  const supabase = await createSupabaseServerClient()

  const { data: authUser, error: userError } = await supabase.auth.getUser()

  if (userError) {
    console.error("[profile] Failed to reload user session during update", userError)
    return UpdateCurrentProfileResultSchema.parse({
      success: false,
      error: "Unable to verify your session. Please refresh and try again.",
      data: null,
    })
  }

  const { firstName, lastName } = parsed.data

  const { error: updateError } = await supabase
    .from("profiles")
    .upsert(
      {
        user_id: authProfile.userId,
        first_name: firstName,
        last_name: lastName,
        is_teacher: authProfile.isTeacher,
      },
      { onConflict: "user_id" },
    )

  if (updateError) {
    console.error("[profile] Failed to update profile", updateError)
    return UpdateCurrentProfileResultSchema.parse({
      success: false,
      error: "We couldn't save your profile just now. Please try again.",
      data: null,
    })
  }

  revalidatePath("/profile")
  revalidatePath("/profiles")

  const profile = CurrentProfileSchema.parse({
    user_id: authProfile.userId,
    email: authUser?.user?.email ?? null,
    first_name: firstName,
    last_name: lastName,
    is_teacher: authProfile.isTeacher,
  })

  return UpdateCurrentProfileResultSchema.parse({
    success: true,
    error: null,
    data: profile,
  })
}

export async function readProfileDetailAction(profileId: string): Promise<ReadProfileDetailResult> {
  const parsed = ProfileIdSchema.safeParse({ profileId })

  if (!parsed.success) {
    const [firstError] = parsed.error.issues
    return ReadCurrentProfileResultSchema.parse({
      data: null,
      error: firstError?.message ?? "Invalid profile identifier provided.",
    })
  }

  const authProfile = await requireAuthenticatedProfile()
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser()

  if (sessionError) {
    console.error("[profile] Failed to load auth session for profile detail", sessionError)
    return ReadCurrentProfileResultSchema.parse({
      data: null,
      error: "Unable to load profile details right now. Please try again shortly.",
    })
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, first_name, last_name, is_teacher")
    .eq("user_id", parsed.data.profileId)
    .maybeSingle()

  if (profileError && profileError.code !== "PGRST116") {
    console.error("[profile] Failed to read profile detail", profileError)
    return ReadCurrentProfileResultSchema.parse({
      data: null,
      error: "Unable to load profile details right now. Please try again shortly.",
    })
  }

  if (!profileRow) {
    return ReadCurrentProfileResultSchema.parse({
      data: null,
      error: "Profile not found.",
    })
  }

  const email = user && user.id === profileRow.user_id ? user.email ?? null : null

  const profile = CurrentProfileSchema.parse({
    user_id: profileRow.user_id,
    email,
    first_name: profileRow.first_name ?? null,
    last_name: profileRow.last_name ?? null,
    is_teacher: Boolean(profileRow.is_teacher ?? false),
  })

  return ReadCurrentProfileResultSchema.parse({
    data: profile,
    error: null,
  })
}

export async function updateProfileDetailAction(
  input: UpdateProfileDetailInput,
): Promise<UpdateProfileDetailResult> {
  const parsed = UpdateProfileDetailInputSchema.safeParse(input)

  if (!parsed.success) {
    const [firstError] = parsed.error.issues
    return UpdateCurrentProfileResultSchema.parse({
      success: false,
      error: firstError?.message ?? "Invalid profile details provided.",
      data: null,
    })
  }

  const { profileId, firstName, lastName } = parsed.data

  const authProfile = await requireAuthenticatedProfile()
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser()

  if (sessionError) {
    console.error("[profile] Failed to load auth session during profile detail update", sessionError)
    return UpdateCurrentProfileResultSchema.parse({
      success: false,
      error: "Unable to verify your session. Please refresh and try again.",
      data: null,
    })
  }

  const { data: updatedRow, error: updateError } = await supabase
    .from("profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
    })
    .eq("user_id", profileId)
    .select("user_id, first_name, last_name, is_teacher")
    .maybeSingle()

  if (updateError) {
    console.error("[profile] Failed to update profile detail", { profileId, updateError })
    return UpdateCurrentProfileResultSchema.parse({
      success: false,
      error: "We couldn't save that profile just now. Please try again.",
      data: null,
    })
  }

  if (!updatedRow) {
    return UpdateCurrentProfileResultSchema.parse({
      success: false,
      error: "Profile not found.",
      data: null,
    })
  }

  revalidatePath(`/profiles/${profileId}`)
  revalidatePath("/profiles")
  revalidatePath(`/profile/dashboard/${profileId}`)

  const email = user && user.id === profileId ? user.email ?? null : null

  const profile = CurrentProfileSchema.parse({
    user_id: updatedRow.user_id,
    email,
    first_name: updatedRow.first_name ?? null,
    last_name: updatedRow.last_name ?? null,
    is_teacher: Boolean(updatedRow.is_teacher ?? false),
  })

  return UpdateCurrentProfileResultSchema.parse({
    success: true,
    error: null,
    data: profile,
  })
}
