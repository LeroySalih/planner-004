"use client"

import { useActionState } from "react"
import Link from "next/link"

import { requestPasswordResetAction, type ForgotPasswordState } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const INITIAL_STATE: ForgotPasswordState = { status: "idle", message: null }

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, INITIAL_STATE)

  if (state.status === "done") {
    return (
      <div className="space-y-4">
        <p className="text-sm" role="status">
          {state.message}
        </p>
        <Link href="/signin" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending}>
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending..." : "Send me a link"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/signin" className="text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  )
}
