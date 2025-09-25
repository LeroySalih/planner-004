"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

type GroupPanelProps = {
  group: {
    group_id: string
    subject: string | null
    join_code: string
    active: boolean
  }
  totalMembers: number
  pupilCount: number
  otherRoles: Array<[string, number]>
}

export function GroupDetailsPanel({ group, totalMembers, pupilCount, otherRoles }: GroupPanelProps) {
  const [open, setOpen] = useState(true)

  const title = useMemo(() => {
    return `${group.group_id} · ${group.subject ?? "Unassigned"}`
  }, [group.group_id, group.subject])

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-medium text-foreground transition hover:bg-muted/60"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {title}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
            group.active
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {group.active ? "Active" : "Inactive"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-border px-5 py-4 text-sm">
          <dl className="space-y-2">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Group ID</dt>
              <dd className="font-medium text-foreground">{group.group_id}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Subject</dt>
              <dd className="font-medium text-foreground">{group.subject ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Join code</dt>
              <dd className="font-medium text-foreground">{group.join_code}</dd>
            </div>
          </dl>

          <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Members</p>
              <p className="text-lg font-semibold text-foreground">{totalMembers}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Pupils</p>
              <p className="text-lg font-semibold text-foreground">{pupilCount}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Other roles</p>
              <p className="text-lg font-semibold text-foreground">{Math.max(totalMembers - pupilCount, 0)}</p>
            </div>
          </div>

          {otherRoles.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role breakdown</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {otherRoles.map(([role, count]) => (
                  <li key={role} className="flex items-center justify-between rounded-md border border-border/60 bg-background px-3 py-2">
                    <span className="capitalize text-muted-foreground">{role}</span>
                    <span className="font-medium text-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
