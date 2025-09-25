import Link from "next/link"
import { notFound } from "next/navigation"

import { readGroupAction } from "@/lib/server-updates"

const roleLabelMap: Record<string, string> = {
  pupil: "Pupil",
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const result = await readGroupAction(groupId)

  if (result.error && !result.data) {
    throw new Error(result.error)
  }

  const group = result.data

  if (!group) {
    notFound()
  }

  const membershipError = result.error
  const pupils = group.members.filter((member) => member.role.toLowerCase() === "pupil")

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <div className="mb-6 text-sm text-muted-foreground">
        <Link href="/groups" className="underline-offset-4 hover:underline">
          ← Back to groups
        </Link>
      </div>

      <header className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Group</p>
        <h1 className="text-3xl font-semibold text-primary">{group.group_id}</h1>
        <p className="text-muted-foreground">
          Subject: <span className="font-medium text-foreground">{group.subject}</span>
        </p>
      </header>

      {membershipError ? (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load group membership: {membershipError}
        </div>
      ) : null}

      <section className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Group Details</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Join code</dt>
              <dd className="font-medium text-foreground">{group.join_code}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium text-foreground">{group.active ? "Active" : "Inactive"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Total members</dt>
              <dd className="font-medium text-foreground">{group.members.length}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Pupils</h2>
          {pupils.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No pupils assigned to this group yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {pupils.map((member) => (
                <li
                  key={member.user_id}
                  className="flex items-center justify-between rounded-md border border-border/60 bg-background px-3 py-2"
                >
                  <span className="font-medium text-foreground">{member.user_id}</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {roleLabelMap[member.role.toLowerCase()] ?? member.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  )
}
