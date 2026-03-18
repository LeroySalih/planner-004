"use client"

import { useState, useEffect, useTransition } from "react"
import Link from "next/link"
import { readRecentSubmissionsAction, type RecentSubmissionsItem } from "@/lib/server-updates"
import { cn } from "@/lib/utils"

const HOURS_OPTIONS = [1, 24, 48, 72] as const
type Hours = typeof HOURS_OPTIONS[number]

export function RecentSubmissionsPanel() {
  const [hours, setHours] = useState<Hours>(24)
  const [items, setItems] = useState<RecentSubmissionsItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      const result = await readRecentSubmissionsAction(hours)
      if (result.error) {
        setError(result.error)
        setItems([])
      } else {
        setError(null)
        setItems(result.data ?? [])
      }
    })
  }, [hours])

  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-green-400">Recent Submissions</span>
        <span className="rounded-full bg-green-400/10 px-2 py-0.5 text-xs font-bold text-green-400">
          {items.length}
        </span>
      </div>

      <div className="flex gap-1">
        {HOURS_OPTIONS.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => setHours(h)}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              hours === h
                ? "border-green-400 bg-green-400/10 text-green-400"
                : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600"
            }`}
          >
            {h}h
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : isPending && items.length === 0 ? (
        <p className="text-xs text-slate-500">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500">No submissions in the last {hours}h.</p>
      ) : (
        <div className={cn("flex flex-wrap gap-1.5", isPending && "opacity-60")}>
          {items.map((item) => (
            <Link
              key={`${item.lessonId}-${item.groupId}`}
              href={`/feedback/groups/${encodeURIComponent(item.groupId)}/lessons/${encodeURIComponent(item.lessonId)}`}
              className="flex flex-col rounded-md border border-green-900 bg-green-950/40 px-2.5 py-2 hover:border-green-700"
            >
              <span className="text-xs font-semibold text-green-300">{item.lessonTitle}</span>
              <span className="text-xs text-slate-500">{item.groupName}</span>
              <span className="mt-1 self-start rounded-full bg-green-400/10 px-1.5 py-0.5 text-xs font-bold text-green-400">
                {item.submissionCount} sub{item.submissionCount !== 1 ? "s" : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
