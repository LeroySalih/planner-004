"use client"

import { useActionState, useMemo, useState } from "react"
import Link from "next/link"

import { resetPasswordAction, type ResetPasswordState } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const INITIAL_STATE: ResetPasswordState = { status: "idle", message: null }

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL_STATE)

  const validationMessage = useMemo(() => {
    if (password.length === 0 && confirmPassword.length === 0) return null
    if (password.trim().length < 6) return "Password must be at least 6 characters."
    if (password !== confirmPassword) return "Passwords must match."
    return null
  }, [password, confirmPassword])

  if (state.status === "invalid-token") {
    return (
      <div className="space-y-4">
        <p className="text-sm">{state.message}</p>
        <Link href="/forgot-password" className="text-sm text-primary underline-offset-4 hover:underline">
          Ask for a new link
        </Link>
      </div>
    )
  }

  const canSubmit = validationMessage === null && password.length > 0 && confirmPassword.length > 0 && !pending

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="token" value={token} />
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
      {!validationMessage && state.status === "error" ? (
        <p className="text-sm text-destructive">{state.message}</p>
      ) : null}
      <Button type="submit" className="w-full" disabled={!canSubmit}>
        {pending ? "Saving..." : "Set new password"}
      </Button>
    </form>
  )
}
