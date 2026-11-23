"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import {
  FORGOT_PASSWORD_MESSAGE,
  INVALID_RESET_LINK_MESSAGE,
  forgotPasswordReply,
  resetPasswordWithToken,
} from "@/lib/password-reset"
import { withTelemetry } from "@/lib/telemetry"

export type ForgotPasswordState = { status: "idle" | "done"; message: string | null }

export type ResetPasswordState = { status: "idle" | "error" | "invalid-token"; message: string | null }

const ForgotPasswordInputSchema = z.object({ email: z.string().trim().max(254).email() })

const ResetPasswordInputSchema = z.object({
  token: z.string().max(200),
  password: z.string().max(200),
  confirmPassword: z.string().max(200),
})

/** No auth. Always the same reply; the email (if any) is sent after it. */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const done: ForgotPasswordState = { status: "done", message: FORGOT_PASSWORD_MESSAGE }
  const parsed = ForgotPasswordInputSchema.safeParse({ email: formData.get("email") })
  if (!parsed.success) return done

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  return withTelemetry(
    { routeTag: "/auth:forgot-password", functionName: "requestPasswordResetAction", params: {}, authEndTime: null },
    async () => {
      // The email send is not awaited: the reply must not take longer when an account exists.
      await forgotPasswordReply({ email: parsed.data.email, ip })
      return done
    },
  )
}

/** No auth. The token is checked again here, not only when the page loads. */
export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = ResetPasswordInputSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  })
  if (!parsed.success) return { status: "invalid-token", message: INVALID_RESET_LINK_MESSAGE }

  const result = await withTelemetry(
    { routeTag: "/auth:reset-password", functionName: "resetPasswordAction", params: {}, authEndTime: null },
    () => resetPasswordWithToken(parsed.data),
  )
  if (!result.ok) {
    return { status: result.reason === "invalid-token" ? "invalid-token" : "error", message: result.message }
  }
  redirect("/signin?reset=done")
}
