import type { Metadata } from "next"
import Link from "next/link"
import { connection } from "next/server"

import { passwordResetAvailable } from "@/lib/password-reset"
import { ForgotPasswordForm } from "@/components/password-reset/forgot-password-form"

export const metadata: Metadata = {
  title: "Forgot password",
}

/** Public: anyone may ask for a reset link. */
export default async function ForgotPasswordPage() {
  // Email settings are read at request time, not build time.
  await connection()
  const available = passwordResetAvailable()

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-12">
      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Forgot your password?</h1>
          <p className="text-sm text-muted-foreground">
            {available
              ? "Give the email address of your DINO account. We will send you a link to choose a new password."
              : "DINO cannot send email at the moment. Ask a teacher to reset your password."}
          </p>
        </div>
        <div className="mt-4">
          {available ? (
            <ForgotPasswordForm />
          ) : (
            <Link href="/signin" className="text-sm text-primary underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          )}
        </div>
      </section>
    </main>
  )
}
