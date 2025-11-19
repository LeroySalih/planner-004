"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  INITIAL_PASSWORD_ACTION_STATE,
  type PasswordActionState,
} from "./password-form-state"

type ProfilePasswordFormProps = {
  profileId: string
  action: (state: PasswordActionState, formData: FormData) => Promise<PasswordActionState>
}

export function ProfilePasswordForm({ profileId, action }: ProfilePasswordFormProps) {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [state, formAction, pending] = useActionState(action, INITIAL_PASSWORD_ACTION_STATE)

  useEffect(() => {
    if (state.status === "idle") {
      return
    }

    if (state.status === "success") {
      toast.success(state.message ?? "Password updated.")
      setPassword("")
      setConfirmPassword("")
    } else if (state.status === "error") {
      toast.error(state.message ?? "Unable to update password.")
    }
  }, [state])

  const validationMessage = useMemo(() => {
    if (password.length === 0 && confirmPassword.length === 0) {
      return null
    }

    if (password.trim().length < 6) {
      return "Password must be at least 6 characters."
    }

    if (password !== confirmPassword) {
      return "Passwords must match."
    }

    return null
  }, [password, confirmPassword])

  const canSubmit = validationMessage === null && password.length > 0 && confirmPassword.length > 0 && !pending

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="profileId" value={profileId} />
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          name="password"
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={validationMessage ? true : undefined}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          value={confirmPassword}
          autoComplete="new-password"
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={validationMessage ? true : undefined}
          required
        />
      </div>
      {validationMessage ? <p className="text-sm text-destructive">{validationMessage}</p> : null}
      <Button type="submit" disabled={!canSubmit}>
        {pending ? "Updating..." : "Update password"}
      </Button>
    </form>
  )
}
