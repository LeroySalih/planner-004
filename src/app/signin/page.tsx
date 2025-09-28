import Link from "next/link"
import type { Metadata } from "next"

import { SigninForm } from "@/components/signin"

export const metadata: Metadata = {
  title: "Sign in",
}

export default function SigninPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-12">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-wide text-slate-300">Welcome back</p>
          <h1 className="text-3xl font-semibold text-white">Sign in to Dino</h1>
          <p className="text-sm text-slate-300">
            Enter your email and password to continue planning lessons and managing your groups.
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <SigninForm />
      </section>

      <div className="text-center text-sm text-muted-foreground">
        <Link href="/" className="underline-offset-4 hover:underline">
          ← Back to home
        </Link>
      </div>
    </main>
  )
}

