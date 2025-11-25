import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"

import { readGroupAction, removeGroupMemberAction, resetPupilPasswordAction } from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"

import type { PupilActionState } from "./pupil-action-state"
import { GroupPupilList, type PupilMember } from "./group-pupil-list"

const roleLabelMap: Record<string, string> = {
  pupil: "Pupil",
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const teacherProfile = await requireTeacherProfile()
  const { groupId } = await params
  const result = await readGroupAction(groupId, { currentProfile: teacherProfile })

  if (result.error && !result.data) {
    throw new Error(result.error)
  }

  const group = result.data

  if (!group) {
    notFound()
  }

  const membershipError = result.error
  const pupils: PupilMember[] = group.members
    .filter((member) => member.role.toLowerCase() === "pupil")
    .map((member) => {
      const first = member.profile?.first_name?.trim() ?? ""
      const last = member.profile?.last_name?.trim() ?? ""
      const displayName = `${first} ${last}`.trim()
      return {
        user_id: member.user_id,
        displayName: displayName.length > 0 ? displayName : member.user_id,
        roleLabel: roleLabelMap[member.role.toLowerCase()] ?? member.role,
      }
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName))

  async function handleRemovePupil(_prevState: PupilActionState, formData: FormData): Promise<PupilActionState> {
    "use server"

    const userId = formData.get("userId")
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return {
        status: "error",
        message: "Missing pupil identifier.",
        userId: null,
        displayName: null,
      }
    }

    const rawDisplayName = formData.get("displayName")
    const displayName =
      typeof rawDisplayName === "string" && rawDisplayName.trim().length > 0
        ? rawDisplayName.trim()
        : userId

    const outcome = await removeGroupMemberAction({ groupId, userId }, { currentProfile: teacherProfile })
    if (!outcome.success) {
      console.error("[groups] Failed to remove pupil from group:", { groupId, userId, error: outcome.error })
      return {
        status: "error",
        message: outcome.error ?? "Unable to remove pupil from group.",
        userId,
        displayName,
      }
    }

    return {
      status: "success",
      message: `Removed ${displayName} from this group.`,
      userId,
      displayName,
    }
  }

  async function handleResetPupilPassword(
    _prevState: PupilActionState,
    formData: FormData,
  ): Promise<PupilActionState> {
    "use server"

    const userId = formData.get("userId")
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return {
        status: "error",
        message: "Missing pupil identifier.",
        userId: null,
        displayName: null,
      }
    }

    const rawDisplayName = formData.get("displayName")
    const displayName =
      typeof rawDisplayName === "string" && rawDisplayName.trim().length > 0
        ? rawDisplayName.trim()
        : userId

    const outcome = await resetPupilPasswordAction({ userId }, { currentProfile: teacherProfile })
    if (!outcome.success) {
      console.error("[groups] Failed to reset pupil password:", { groupId, userId, error: outcome.error })
      return {
        status: "error",
        message: outcome.error ?? "Unable to reset pupil password.",
        userId,
        displayName,
      }
    }

    return {
      status: "success",
      message: `Password reset for ${displayName}.`,
      userId,
      displayName,
    }
  }

  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-6xl px-6 py-10">Loading group…</div>}>
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
              <GroupPupilList
                pupils={pupils}
                resetPupilPasswordAction={handleResetPupilPassword}
                removePupilAction={handleRemovePupil}
              />
            )}
          </div>
        </section>
      </main>
    </Suspense>
  )
}
