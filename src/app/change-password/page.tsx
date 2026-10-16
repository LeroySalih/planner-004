import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { updateProfilePasswordAction } from "@/lib/server-updates"
import { ProfilePasswordForm } from "@/components/profile/password-form"
import type { PasswordActionState } from "@/components/profile/password-form-state"

export const metadata: Metadata = {
  title: "Choose a new password",
}

const isSafeReturnTo = (url: string | undefined): url is string =>
  typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/change-password")

/**
 * Where a user on the shared default password is sent until they choose their
 * own (see CHANGE_PASSWORD_PATH in src/lib/auth.ts).
 */
export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>
}) {
  const profile = await getAuthenticatedProfile()
  if (!profile) redirect("/signin")

  const { returnTo } = await searchParams
  const next = isSafeReturnTo(returnTo)
    ? returnTo
    : hasRole(profile, "teacher")
      ? "/teacher-planner"
      : `/pupil-lessons/${encodeURIComponent(profile.userId)}`

  async function handlePasswordChange(
    _prevState: PasswordActionState,
    formData: FormData,
  ): Promise<PasswordActionState> {
    "use server"

    const password = formData.get("password")
    const confirmPassword = formData.get("confirmPassword")
    if (typeof password !== "string" || typeof confirmPassword !== "string") {
      return { status: "error", message: "Password is required." }
    }
    if (password !== confirmPassword) {
      return { status: "error", message: "Passwords must match." }
    }

    const result = await updateProfilePasswordAction({ profileId: profile!.userId, password: password.trim() })
    if (!result.success) {
      return { status: "error", message: result.error ?? "Unable to update password." }
    }
    redirect(next)
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-12">
      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">
            {profile.mustChangePassword
              ? "Your account is using the default password. Choose your own, at least 6 characters, to carry on."
              : "Choose a new password with at least 6 characters."}
          </p>
        </div>
        <div className="mt-4">
          <ProfilePasswordForm profileId={profile.userId} action={handlePasswordChange} />
        </div>
      </section>
    </main>
  )
}
