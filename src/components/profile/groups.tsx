import { revalidatePath } from "next/cache"

import {
  joinGroupByCodeAction,
  leaveGroupAction as leaveGroupMembershipAction,
  readProfileGroupsForCurrentUserAction,
} from "@/lib/server-actions/groups"
import { type GroupActionState, JoinGroupForm, LeaveGroupForm } from "@/components/profile/groups-client"

export async function ProfileGroups() {
  const result = await readProfileGroupsForCurrentUserAction()

  if (!result.data) {
    return (
      <div className="flex flex-col gap-4">
        {result.error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {result.error}
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-card p-6 text-sm text-destructive">
          We couldn&apos;t load your groups right now. Please try again.
        </div>
      </div>
    )
  }

  const { profile, memberships } = result.data

  async function joinGroup(_: GroupActionState, formData: FormData): Promise<GroupActionState> {
    "use server"

    const joinCode = (formData.get("joinCode") ?? "").toString()
    const joinResult = await joinGroupByCodeAction({ joinCode })

    if (joinResult.success) {
      const descriptor = joinResult.subject
        ? `${joinResult.subject} (${joinResult.groupId})`
        : joinResult.groupId ?? joinCode.toUpperCase()

      revalidatePath(`/profiles/${profile.user_id}`)
      revalidatePath("/profile/groups") // Also update old page if it exists
      
      return {
        status: "success",
        message: `Joined ${descriptor} successfully.`,
        timestamp: Date.now(),
      }
    } 
    
    return {
      status: "error",
      message: joinResult.error ?? "Unable to join that group right now.",
      timestamp: Date.now(),
    }
  }

  async function leaveGroup(_: GroupActionState, formData: FormData): Promise<GroupActionState> {
    "use server"

    const groupId = (formData.get("groupId") ?? "").toString()
    const leaveResult = groupId
      ? await leaveGroupMembershipAction({ groupId })
      : { success: false, error: "Missing group to leave." }

    if (leaveResult.success) {
      revalidatePath(`/profiles/${profile.user_id}`)
      revalidatePath("/profile/groups")

      return {
        status: "success",
        message: "Left the group successfully.",
        timestamp: Date.now(),
      }
    }

    return {
      status: "error",
      message: leaveResult.error ?? "Unable to leave that group right now.",
      timestamp: Date.now(),
    }
  }

  const sortedMemberships = [...memberships].sort((a, b) => a.group_id.localeCompare(b.group_id))
  const roleLabel = profile.is_teacher ? "teacher" : "pupil"

  return (
    <div className="flex flex-col gap-6">
      {result.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {result.error}
        </div>
      ) : null}

      <JoinGroupForm action={joinGroup} roleLabel={roleLabel} />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Groups you belong to</h2>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {sortedMemberships.length} {sortedMemberships.length === 1 ? "group" : "groups"}
          </span>
        </div>

        {sortedMemberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have not joined any groups yet.</p>
        ) : (
          <ul className="grid gap-3">
            {sortedMemberships.map((membership) => {
              const group = membership.group

              return (
                <li key={membership.group_id} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-foreground">
                        {group?.subject ?? membership.group_id}
                      </span>
                      <span className="text-xs text-muted-foreground">{membership.group_id}</span>
                      <span className="text-xs uppercase text-muted-foreground">Role: {membership.role}</span>
                    </div>

                    <LeaveGroupForm action={leaveGroup} groupId={membership.group_id} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
