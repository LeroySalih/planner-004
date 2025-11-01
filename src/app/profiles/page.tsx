import Link from "next/link"
import type { Metadata } from "next"

import { ProfileForm } from "@/components/profile"
import { requireAuthenticatedProfile } from "@/lib/auth"

export const metadata: Metadata = {
  title: "Complete your profile",
}

export default async function ProfilesPage() {
  await requireAuthenticatedProfile()

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-12">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-wide text-slate-300">Welcome</p>
          <h1 className="text-3xl font-semibold text-white">Tell us about you</h1>
          <p className="text-sm text-slate-300">
            Add your name so teachers and pupils can easily recognise you across the Planner experience.
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <ProfileForm />
      </section>

      <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="underline-offset-4 hover:underline">
          ← Back to home
        </Link>
        <Link href="/profiles/groups" className="text-primary underline-offset-4 hover:underline">
          Go to group memberships
        </Link>
      </div>
    </main>
  )
}
