import Link from "next/link"
import { notFound } from "next/navigation"

import { readGroupAction } from "@/lib/server-updates"
import { removeGroupMemberAction } from "@/lib/server-actions/groups"
import { requireTeacherProfile } from "@/lib/auth"
import { Button } from "@/components/ui/button"

const roleLabelMap: Record<string, string> = {
  pupil: "Pupil",
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  await requireTeacherProfile()
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
  const pupils = group.members
    .filter((member) => member.role.toLowerCase() === "pupil")
    .map((member) => {
      const first = member.profile?.first_name?.trim() ?? ""
      const last = member.profile?.last_name?.trim() ?? ""
      const displayName = `${first} ${last}`.trim()
      return {
        ...member,
        displayName: displayName.length > 0 ? displayName : member.user_id,
      }
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName))

  async function handleRemovePupil(formData: FormData) {
    "use server"

    const userId = formData.get("userId")
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return
    }

    const outcome = await removeGroupMemberAction({ groupId, userId })
    if (!outcome.success) {
      console.error("[groups] Failed to remove pupil from group:", { groupId, userId, error: outcome.error })
      throw new Error(outcome.error ?? "Unable to remove pupil from group.")
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10 text-slate-900">
      <div className="mb-6 text-sm text-slate-600">
        <Link href="/groups" className="underline-offset-4 hover:underline">
          ← Back to groups
        </Link>
      </div>

      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Group</p>
          <div>
            <h1 className="text-3xl font-semibold text-white">{group.group_id}</h1>
            <p className="mt-2 text-sm text-slate-200">
              Subject: <span className="font-medium text-white">{group.subject}</span>
            </p>
          </div>
        </div>
      </header>

      {membershipError ? (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load group membership: {membershipError}
        </div>
      ) : null}

      <section className="mt-6">
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Pupils</h2>
          {pupils.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No pupils assigned to this group yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {pupils.map((member) => (
                <li
                  key={member.user_id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
                >
                  <div className="flex flex-col">
                    <Link
                      href={`/reports/${member.user_id}`}
                      className="font-medium text-slate-900 underline-offset-4 hover:underline"
                    >
                      {member.displayName}
                    </Link>
                    {member.displayName !== member.user_id ? (
                      <span className="text-xs text-slate-500">{member.user_id}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {roleLabelMap[member.role.toLowerCase()] ?? member.role}
                    </span>
                    <form action={handleRemovePupil} className="flex items-center">
                      <input type="hidden" name="userId" value={member.user_id} />
                      <Button type="submit" variant="outline" size="sm" className="text-xs">
                        Remove
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  )
}
