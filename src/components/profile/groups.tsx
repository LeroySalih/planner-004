import { redirect } from "next/navigation"

import {
  joinGroupByCodeAction,
  leaveGroupAction as leaveGroupMembershipAction,
  readProfileGroupsForCurrentUserAction,
} from "@/lib/server-actions/groups"
import { Button } from "@/components/ui/button"

type FeedbackState =
  | {
      variant: "success" | "error"
      message: string
    }
  | null

type ProfileGroupsManagerProps = {
  feedback: FeedbackState
}

export async function ProfileGroupsManager({ feedback }: ProfileGroupsManagerProps) {
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

  async function joinGroup(formData: FormData) {
    "use server"

    const joinCode = (formData.get("joinCode") ?? "").toString()
    const joinResult = await joinGroupByCodeAction({ joinCode })
    const params = new URLSearchParams()

    if (joinResult.success) {
      params.set("status", "success")

      const descriptor = joinResult.subject
        ? `${joinResult.subject} (${joinResult.groupId})`
        : joinResult.groupId ?? joinCode.toUpperCase()

      params.set("message", `Joined ${descriptor} successfully.`)
    } else {
      params.set("status", "error")
      params.set("message", joinResult.error ?? "Unable to join that group right now.")
    }

    redirect(`/profile/groups?${params.toString()}`)
  }

  async function leaveGroup(formData: FormData) {
    "use server"

    const groupId = (formData.get("groupId") ?? "").toString()
    const leaveResult = groupId
      ? await leaveGroupMembershipAction({ groupId })
      : { success: false, error: "Missing group to leave." }

    const params = new URLSearchParams()

    if (leaveResult.success) {
      params.set("status", "success")
      params.set("message", "Left the group successfully.")
    } else {
      params.set("status", "error")
      params.set("message", leaveResult.error ?? "Unable to leave that group right now.")
    }

    redirect(`/profile/groups?${params.toString()}`)
  }

  const sortedMemberships = [...memberships].sort((a, b) => a.group_id.localeCompare(b.group_id))
  const roleLabel = profile.is_teacher ? "teacher" : "pupil"

  return (
    <div className="flex flex-col gap-6">
      {feedback && feedback.message ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.variant === "success"
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-700"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      {result.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {result.error}
        </div>
      ) : null}

      <form action={joinGroup} className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <label htmlFor="join-code" className="text-sm font-medium text-foreground">
            Join a group
          </label>
          <input
            id="join-code"
            name="joinCode"
            maxLength={5}
            placeholder="Enter 5 character code"
            required
            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="text-xs text-muted-foreground">
            You are currently signed in as a {roleLabel}. Ask your teacher for the 5 character join code.
          </p>
        </div>

        <Button type="submit" className="w-full">
          Join group
        </Button>
      </form>

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

                    <form action={leaveGroup}>
                      <input type="hidden" name="groupId" value={membership.group_id} />
                      <Button type="submit" variant="outline">
                        Leave group
                      </Button>
                    </form>
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
