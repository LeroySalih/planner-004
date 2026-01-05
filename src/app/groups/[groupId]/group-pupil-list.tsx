"use client"

import Link from "next/link"
import { useActionState, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Lock } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { initialPupilActionState, type PupilActionState } from "./pupil-action-state"

export type PupilMember = {
  user_id: string
  displayName: string
  roleLabel: string
  role: string
  locked: boolean
  email: string | null
}

type GroupPupilListProps = {
  pupils: PupilMember[]
  resetPupilPasswordAction: (
    state: PupilActionState,
    formData: FormData,
  ) => Promise<PupilActionState>
  removePupilAction: (
    state: PupilActionState,
    formData: FormData,
  ) => Promise<PupilActionState>
  unlockPupilAction: (
    state: PupilActionState,
    formData: FormData,
  ) => Promise<PupilActionState>
  updateRoleAction: (userId: string, role: string) => Promise<{ success: boolean; error: string | null }>
}

function useActionToast(state: PupilActionState) {
  const lastHandledState = useRef<PupilActionState | null>(null)

  useEffect(() => {
    if (state.status === "idle") {
      lastHandledState.current = state
      return
    }

    if (lastHandledState.current === state) {
      return
    }

    lastHandledState.current = state

    const message =
      state.message ?? (state.status === "success" ? "Action completed." : "Unable to complete the action.")

    if (state.status === "success") {
      toast.success(message)
    } else if (state.status === "error") {
      toast.error(message)
    }
  }, [state])
}

function GroupPupilRow({
  pupil,
  resetPupilPasswordAction,
  removePupilAction,
  unlockPupilAction,
  updateRoleAction,
}: {
  pupil: PupilMember
  resetPupilPasswordAction: (
    state: PupilActionState,
    formData: FormData,
  ) => Promise<PupilActionState>
  removePupilAction: (
    state: PupilActionState,
    formData: FormData,
  ) => Promise<PupilActionState>
  unlockPupilAction: (
    state: PupilActionState,
    formData: FormData,
  ) => Promise<PupilActionState>
  updateRoleAction: (userId: string, role: string) => Promise<{ success: boolean; error: string | null }>
}) {
  const [resetState, resetFormAction, resetPending] = useActionState(
    resetPupilPasswordAction,
    initialPupilActionState,
  )
  const [removeState, removeFormAction, removePending] = useActionState(removePupilAction, initialPupilActionState)
  const [unlockState, unlockFormAction, unlockPending] = useActionState(
    unlockPupilAction,
    initialPupilActionState,
  )
  const [locked, setLocked] = useState(pupil.locked)
  const [role, setRole] = useState(pupil.role)
  const [isPending, startTransition] = useTransition()

  useActionToast(resetState)
  useActionToast(removeState)
  useActionToast(unlockState)

  useEffect(() => {
    if (unlockState.status === "success") {
      setLocked(false)
    }
  }, [unlockState.status])

  useEffect(() => {
    setLocked(pupil.locked)
  }, [pupil.locked])

  const handleRoleChange = (newRole: string) => {
    const previousRole = role
    setRole(newRole)
    startTransition(async () => {
      const result = await updateRoleAction(pupil.user_id, newRole)
      if (result.success) {
        toast.success("Role updated.")
      } else {
        toast.error(result.error ?? "Failed to update role.")
        setRole(previousRole)
      }
    })
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2">
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <Link
            href={`/reports/${encodeURIComponent(pupil.user_id)}`}
            className="font-medium text-slate-900 underline-offset-4 hover:underline"
          >
            {pupil.displayName}
          </Link>
          {locked || unlockPending ? (
            <form action={unlockFormAction} className="flex items-center">
              <input type="hidden" name="userId" value={pupil.user_id} />
              <input type="hidden" name="displayName" value={pupil.displayName} />
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                className={`h-7 w-7 text-amber-600 ${unlockPending ? "animate-pulse opacity-70" : ""}`}
                disabled={unlockPending}
                title="Unlock sign-in"
              >
                <Lock className="h-4 w-4" />
                <span className="sr-only">Unlock sign-in</span>
              </Button>
            </form>
          ) : null}
        </div>
        {pupil.displayName !== pupil.user_id ? (
          <span className="text-xs text-slate-500">{pupil.user_id}</span>
        ) : null}
        {pupil.email ? <span className="text-xs text-slate-500">{pupil.email}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <Select value={role} onValueChange={handleRoleChange} disabled={isPending}>
          <SelectTrigger className="h-7 w-[90px] text-xs uppercase tracking-wide">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pupil">Pupil</SelectItem>
            <SelectItem value="teacher">Teacher</SelectItem>
          </SelectContent>
        </Select>

        <form action={resetFormAction} className="flex items-center">
          <input type="hidden" name="userId" value={pupil.user_id} />
          <input type="hidden" name="displayName" value={pupil.displayName} />
          <Button type="submit" variant="secondary" size="sm" className="text-xs" disabled={resetPending}>
            {resetPending ? "Resetting..." : "Reset"}
          </Button>
        </form>
        <form action={removeFormAction} className="flex items-center">
          <input type="hidden" name="userId" value={pupil.user_id} />
          <input type="hidden" name="displayName" value={pupil.displayName} />
          <Button type="submit" variant="outline" size="sm" className="text-xs" disabled={removePending}>
            {removePending ? "Removing..." : "Remove"}
          </Button>
        </form>
      </div>
    </li>
  )
}

export function GroupPupilList({
  pupils,
  resetPupilPasswordAction,
  removePupilAction,
  unlockPupilAction,
  updateRoleAction,
}: GroupPupilListProps) {
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {pupils.map((pupil) => (
        <GroupPupilRow
          key={pupil.user_id}
          pupil={pupil}
          resetPupilPasswordAction={resetPupilPasswordAction}
          removePupilAction={removePupilAction}
          unlockPupilAction={unlockPupilAction}
          updateRoleAction={updateRoleAction}
        />
      ))}
    </ul>
  )
}
