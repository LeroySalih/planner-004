"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

import { createWildcardRegex } from "@/lib/search"

export type ReportsTablePupil = {
  pupilId: string
  name: string
  groups: string[]
}

export function ReportsTable({ pupils }: { pupils: ReportsTablePupil[] }) {
  const [filter, setFilter] = useState("")

  const filtered = useMemo(() => {
    const trimmed = filter.trim()
    if (!trimmed) return pupils
    try {
      const regex = createWildcardRegex(trimmed)
      return pupils.filter((pupil) => {
        if (regex.test(pupil.name)) return true
        return pupil.groups.some((groupId) => regex.test(groupId))
      })
    } catch (error) {
      console.error("[reports] Invalid filter", error)
      return []
    }
  }, [filter, pupils])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by group or pupil (use '?' as wildcard)"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-auto rounded-lg border border-border">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-muted text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="border border-border px-4 py-2 text-left">Pupil</th>
              <th className="border border-border px-4 py-2 text-left">Groups</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No pupils match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((pupil) => (
                <tr key={pupil.pupilId}>
                  <td className="border border-border px-4 py-2 align-top font-medium text-foreground">
                    <Link href={`/reports/${pupil.pupilId}`} className="underline-offset-4 hover:underline">
                      {pupil.name}
                    </Link>
                  </td>
                  <td className="border border-border px-4 py-2 align-top text-muted-foreground">
                    {pupil.groups.join(", ") || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
