"use client"

import { useActionState, useEffect, useRef } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

export type GroupActionState = {
  status: "idle" | "success" | "error"
  message: string
  timestamp: number
}

const INITIAL_STATE: GroupActionState = { status: "idle", message: "", timestamp: 0 }

type JoinGroupFormProps = {
  action: (prevState: GroupActionState, formData: FormData) => Promise<GroupActionState>
  roleLabel: string
}

function useActionToast(state: GroupActionState) {
  const lastTimestamp = useRef(state.timestamp)

  useEffect(() => {
    if (state.timestamp === lastTimestamp.current) return
    lastTimestamp.current = state.timestamp

    if (state.status === "success") {
      toast.success(state.message)
    } else if (state.status === "error") {
      toast.error(state.message)
    }
  }, [state])
}

export function JoinGroupForm({ action, roleLabel }: JoinGroupFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE)
  useActionToast(state)

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
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
          disabled={pending}
          className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p className="text-xs text-muted-foreground">
          You are currently signed in as a {roleLabel}. Ask your teacher for the 5 character join code.
        </p>
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Joining…
          </>
        ) : (
          "Join group"
        )}
      </Button>
    </form>
  )
}

type LeaveGroupFormProps = {
  action: (prevState: GroupActionState, formData: FormData) => Promise<GroupActionState>
  groupId: string
}

export function LeaveGroupForm({ action, groupId }: LeaveGroupFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE)
  useActionToast(state)

  return (
    <form action={formAction}>
      <input type="hidden" name="groupId" value={groupId} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Leaving…
          </>
        ) : (
          "Leave group"
        )}
      </Button>
    </form>
  )
}
