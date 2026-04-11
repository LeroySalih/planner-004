"use client"

import { useRouter } from "next/navigation"
import type { DashboardProgressItem } from "@/lib/server-updates"

export function ProgressCard({ item }: { item: DashboardProgressItem }) {
  const router = useRouter()
  const { groupId, groupSubject, totalPupils, greenCount, amberCount, redCount } = item

  const total = greenCount + amberCount + redCount
  const greenPct = total > 0 ? Math.round((greenCount / total) * 100) : 0
  const amberPct = total > 0 ? Math.round((amberCount / total) * 100) : 0
  const redPct = total > 0 ? 100 - greenPct - amberPct : 0

  return (
    <button
      type="button"
      onClick={() => router.push(`/unit-progress-reports/${groupId}`)}
      className="w-full rounded-lg border border-border bg-card p-5 text-left transition-shadow hover:shadow-md"
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{groupId}</div>
          <div className="text-xs text-muted-foreground">{groupSubject}</div>
        </div>
        <div className="text-xs text-muted-foreground">{totalPupils} pupils</div>
      </div>

      {/* Stacked bar */}
      <div className="mb-2 flex h-7 overflow-hidden rounded-md">
        {greenPct > 0 && (
          <div
            className="flex items-center justify-center bg-green-500 text-xs font-semibold text-white"
            style={{ width: `${greenPct}%` }}
          >
            {greenPct}%
          </div>
        )}
        {amberPct > 0 && (
          <div
            className="flex items-center justify-center bg-amber-500 text-xs font-semibold text-white"
            style={{ width: `${amberPct}%` }}
          >
            {amberPct}%
          </div>
        )}
        {redPct > 0 && (
          <div
            className="flex items-center justify-center bg-red-500 text-xs font-semibold text-white"
            style={{ width: `${redPct}%` }}
          >
            {redPct}%
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-green-500" />
          {greenCount} ≥70%
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-500" />
          {amberCount} 40–69%
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-500" />
          {redCount} &lt;40%
        </span>
      </div>
    </button>
  )
}
