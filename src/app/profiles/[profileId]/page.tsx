import Link from "next/link"
import type { Metadata } from "next"

import { updateProfilePasswordAction } from "@/lib/server-updates"
import { ProfileDetailForm } from "@/components/profile/detail"
import { ProfilePasswordForm } from "@/components/profile/password-form"
import type { PasswordActionState } from "@/components/profile/password-form-state"

export const metadata: Metadata = {
  title: "Profile details",
}

export default async function ProfileDetailPage({
  params,
}: {
  params: Promise<{ profileId: string }>
}) {
  const { profileId } = await params
  async function handlePasswordUpdate(
    _prevState: PasswordActionState,
    formData: FormData,
  ): Promise<PasswordActionState> {
    "use server"

    const password = formData.get("password")
    const confirmPassword = formData.get("confirmPassword")
    const submittedProfileId = formData.get("profileId")

    if (typeof submittedProfileId !== "string" || submittedProfileId !== profileId) {
      return {
        status: "error",
        message: "Profile mismatch. Please refresh and try again.",
      }
    }

    if (typeof password !== "string" || typeof confirmPassword !== "string") {
      return {
        status: "error",
        message: "Password is required.",
      }
    }

    const trimmedPassword = password.trim()
    if (trimmedPassword.length < 6) {
      return {
        status: "error",
        message: "Password must be at least 6 characters.",
      }
    }

    if (password !== confirmPassword) {
      return {
        status: "error",
        message: "Passwords must match.",
      }
    }

    const result = await updateProfilePasswordAction({
      profileId,
      password: trimmedPassword,
    })

    if (!result.success) {
      return {
        status: "error",
        message: result.error ?? "Unable to update password.",
      }
    }

    return {
      status: "success",
      message: "Password updated.",
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-wide text-slate-300">Profile</p>
          <h1 className="text-3xl font-semibold text-white">Manage your details</h1>
          <p className="text-sm text-slate-300">
            Update your name and review whether your account has teacher access.
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <ProfileDetailForm profileId={profileId} />
      </section>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">Update password</h2>
          <p className="text-sm text-muted-foreground">
            Choose a new password with at least 6 characters. Confirm the value before saving.
          </p>
        </div>
        <div className="mt-4">
          <ProfilePasswordForm profileId={profileId} action={handlePasswordUpdate} />
        </div>
      </section>

      <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/profile/dashboard/${profileId}`} className="underline-offset-4 hover:underline">
          ← Back to dashboard
        </Link>
        <Link href="/profiles/groups" className="text-primary underline-offset-4 hover:underline">
          Manage group memberships
        </Link>
      </div>
    </main>
  )
}
