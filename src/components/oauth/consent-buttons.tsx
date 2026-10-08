"use client"

import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"
import { approveOAuthAuthorizationAction, denyOAuthAuthorizationAction } from "@/lib/server-updates"

export function ConsentButtons() {
  const { pending } = useFormStatus()
  return (
    <div className="flex justify-end gap-3">
      <Button type="submit" variant="outline" formAction={denyOAuthAuthorizationAction} disabled={pending}>
        Deny
      </Button>
      <Button type="submit" formAction={approveOAuthAuthorizationAction} disabled={pending}>
        {pending ? "Connecting…" : "Allow"}
      </Button>
    </div>
  )
}
