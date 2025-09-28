import Link from "next/link"
import type { Metadata } from "next"

import { ProfileDetailForm } from "@/components/profile/detail"

export const metadata: Metadata = {
  title: "Profile details",
}

export default async function ProfileDetailPage({
  params,
}: {
  params: Promise<{ profileId: string }>
}) {
  const { profileId } = await params

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

