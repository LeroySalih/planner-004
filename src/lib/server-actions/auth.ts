"use server"

import { z } from "zod"

import { createSupabaseServiceClient } from "@/lib/supabase/server"
import { withTelemetry } from "@/lib/telemetry"

const SignupInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

type SignupInput = z.infer<typeof SignupInputSchema>

type SignupResult = {
  success: boolean
  error?: string
  userId?: string | null
}

export async function createUserWithoutEmailConfirmationAction(
  input: SignupInput,
): Promise<SignupResult> {
  const parsed = SignupInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    }
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[auth] Service role key missing; cannot create user without confirmation")
    return { success: false, error: "Signup is unavailable. Please contact support." }
  }

  const { email, password } = parsed.data

  return withTelemetry(
    {
      routeTag: "/auth:signup-no-email",
      functionName: "createUserWithoutEmailConfirmationAction",
      params: { email },
      authEndTime: null,
    },
    async () => {
      const supabase = createSupabaseServiceClient()

      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (error) {
        console.error("[auth] Failed to create user without confirmation:", error)
        return { success: false, error: error.message }
      }

      return { success: true, userId: data.user?.id ?? null }
    },
  )
}
