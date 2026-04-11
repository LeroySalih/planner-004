"use client"

import { useState } from "react"
import type { DashboardProgressItem } from "@/lib/server-updates"
import { ProgressCard } from "@/components/teacher-dashboard/progress-card"

export function ProgressDashboard({ items }: { items: DashboardProgressItem[] }) {
  const [filter, setFilter] = useState("")

  const filtered = items.filter((item) => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      item.groupId.toLowerCase().includes(q) ||
      item.groupSubject.toLowerCase().includes(q)
    )
  })

  return (
    <div>
      {/* Filter bar */}
      <div className="px-6 pt-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder='Filter classes… e.g. "9A" or "Computer Science"'
          className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 p-6">
        {filtered.map((item) => (
          <ProgressCard key={item.groupId} item={item} />
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? "No classes found."
              : "No classes match your filter."}
          </p>
        )}
      </div>
    </div>
  )
}
