import Link from "next/link"
import type { Metadata } from "next"

import { ProfileGroupsManager } from "@/components/profile/groups"
import { requireAuthenticatedProfile } from "@/lib/auth"

export const metadata: Metadata = {
  title: "Join groups",
}

type ProfilesGroupsPageProps = {
  searchParams?: {
    status?: string
    message?: string
  }
}

export default async function ProfilesGroupsPage({ searchParams }: ProfilesGroupsPageProps) {
  await requireAuthenticatedProfile()

  const feedback = searchParams?.status
    ? {
        variant: searchParams.status === "success" ? ("success" as const) : ("error" as const),
        message: searchParams.message ?? "",
      }
    : null

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-wide text-slate-300">Groups</p>
          <h1 className="text-3xl font-semibold text-white">Manage group memberships</h1>
          <p className="text-sm text-slate-300">
            Enter a group join code to become part of a class. You can also review the groups you already belong to.
          </p>
        </div>
      </header>

      <ProfileGroupsManager feedback={feedback} />

      <div className="text-center text-sm text-muted-foreground">
        <Link href="/profiles" className="underline-offset-4 hover:underline">
          ← Back to profile
        </Link>
      </div>
    </main>
  )
}
