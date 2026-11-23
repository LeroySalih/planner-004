import type { Metadata } from "next"
import Link from "next/link"

import { findUsableResetToken, INVALID_RESET_LINK_MESSAGE } from "@/lib/password-reset"
import { ResetPasswordForm } from "@/components/password-reset/reset-password-form"

// next.config.ts also sends Referrer-Policy: no-referrer for this path.
export const metadata: Metadata = {
  title: "Choose a new password",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

/** Public: the link from a password reset email. */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token } = await searchParams
  const raw = typeof token === "string" ? token : null
  const usable = raw ? await findUsableResetToken(raw) : null

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-12">
      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Choose a new password</h1>
        <div className="mt-4">
          {usable && raw ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Choose a new password with at least 6 characters.</p>
              <ResetPasswordForm token={raw} />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm">{INVALID_RESET_LINK_MESSAGE}</p>
              <Link href="/forgot-password" className="text-sm text-primary underline-offset-4 hover:underline">
                Ask for a new link
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
