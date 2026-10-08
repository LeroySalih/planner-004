"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { revokeConnectedAppAction } from "@/lib/server-updates"
import { formatDate } from "@/lib/weekly-planner-utils"
import type { ConnectedApp } from "@/types"

export function ConnectedApps({ apps: initialApps }: { apps: ConnectedApp[] }) {
  const [apps, setApps] = useState(initialApps)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const revoke = (app: ConnectedApp) => {
    setRevokingId(app.id)
    startTransition(async () => {
      const result = await revokeConnectedAppAction(app.id)
      setRevokingId(null)
      if (result.error) {
        toast.error(result.error)
        return
      }
      setApps((current) => current.filter((item) => item.id !== app.id))
      toast.success(`${app.client_name} disconnected.`)
    })
  }

  if (apps.length === 0) {
    return <p className="text-sm text-muted-foreground">No apps are connected to your account.</p>
  }

  return (
    <ul className="divide-y divide-border">
      {apps.map((app) => (
        <li key={app.id} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="font-medium">{app.client_name}</p>
            <p className="text-sm text-muted-foreground">
              Connected {formatDate(app.created_at)} · Last used{" "}
              {app.last_used_at ? formatDate(app.last_used_at) : "never"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => revoke(app)}
            disabled={isPending && revokingId === app.id}
          >
            {isPending && revokingId === app.id ? "Revoking…" : "Revoke"}
          </Button>
        </li>
      ))}
    </ul>
  )
}
