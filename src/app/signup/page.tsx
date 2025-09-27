import Link from "next/link"
import type { Metadata } from "next"

import { SignupForm } from "@/components/signup"

export const metadata: Metadata = {
  title: "Sign up",
}

export default function SignupPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-12">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-wide text-slate-300">Create account</p>
          <h1 className="text-3xl font-semibold text-white">Join Dino</h1>
          <p className="text-sm text-slate-300">
            Sign up with your email address to start exploring lesson planning and curriculum tools.
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <SignupForm />
      </section>

      <div className="text-center text-sm text-muted-foreground">
        <Link href="/" className="underline-offset-4 hover:underline">
          ← Back to home
        </Link>
      </div>
    </main>
  )
}
