"use client"

import Link from "next/link"
import { useActionState, useEffect, useRef } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { initialPupilActionState, type PupilActionState } from "./pupil-action-state"

export type PupilMember = {
  user_id: string
  displayName: string
  roleLabel: string
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
}) {
  const [resetState, resetFormAction, resetPending] = useActionState(
    resetPupilPasswordAction,
    initialPupilActionState,
  )
  const [removeState, removeFormAction, removePending] = useActionState(removePupilAction, initialPupilActionState)

  useActionToast(resetState)
  useActionToast(removeState)

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2">
      <div className="flex flex-col">
        <Link
          href={`/reports/${encodeURIComponent(pupil.user_id)}`}
          className="font-medium text-slate-900 underline-offset-4 hover:underline"
        >
          {pupil.displayName}
        </Link>
        {pupil.displayName !== pupil.user_id ? (
          <span className="text-xs text-slate-500">{pupil.user_id}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{pupil.roleLabel}</span>
        <form action={resetFormAction} className="flex items-center">
          <input type="hidden" name="userId" value={pupil.user_id} />
          <input type="hidden" name="displayName" value={pupil.displayName} />
          <Button type="submit" variant="secondary" size="sm" className="text-xs" disabled={resetPending}>
            {resetPending ? "Resetting..." : "Reset password"}
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
}: GroupPupilListProps) {
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {pupils.map((pupil) => (
        <GroupPupilRow
          key={pupil.user_id}
          pupil={pupil}
          resetPupilPasswordAction={resetPupilPasswordAction}
          removePupilAction={removePupilAction}
        />
      ))}
    </ul>
  )
}
