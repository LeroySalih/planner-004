"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { pupilActivityFontClass } from "@/components/pupil-activity/fonts"

export interface ActivitySidebarItem {
  activityId: string
  anchorId: string
  number: number
  title: string
  /** Marks/percentage once scored (takes precedence over `marking`). */
  scoreLabel?: string | null
  /** Submitted but not yet marked. */
  marking?: boolean
}

/**
 * Sticky (fixed) left rail listing a lesson's activities. Clicking an entry
 * smooth-scrolls to that activity; the entry for the activity currently in view
 * is highlighted. Shows the score once available, or a "Marking" chip while a
 * submission is awaiting its mark. Hidden below xl (needs margin room).
 */
export function ActivitySidebar({ items }: { items: ActivitySidebarItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (items.length === 0 || typeof IntersectionObserver === "undefined") return
    const elements = items
      .map((item) => document.getElementById(item.anchorId))
      .filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    )
    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [items])

  const handleClick = (event: React.MouseEvent, anchorId: string) => {
    event.preventDefault()
    document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" })
    setActiveId(anchorId)
  }

  if (items.length === 0) return null

  return (
    <nav
      aria-label="Activities"
      className={cn(
        pupilActivityFontClass,
        "font-[family-name:var(--font-pa-body)]",
        "fixed left-4 top-24 z-30 hidden w-56 2xl:block",
      )}
    >
      <div className="flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-pa-panel border border-pa-card-border bg-pa-card/90 shadow-[0_12px_40px_-28px_rgba(20,35,27,0.45)] backdrop-blur">
        <p className="px-4 pb-2 pt-4 text-[11px] font-bold uppercase tracking-widest text-pa-muted-2">
          Activities
        </p>
        <ol className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {items.map((item) => {
            const active = activeId === item.anchorId
            return (
              <li key={item.activityId}>
                <a
                  href={`#${item.anchorId}`}
                  onClick={(event) => handleClick(event, item.anchorId)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-pa-green-tint text-pa-ink"
                      : "text-pa-muted-1 hover:bg-pa-green-tint/60 hover:text-pa-ink",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 flex-none place-items-center rounded-full font-[family-name:var(--font-pa-num)] text-[10px] font-bold",
                      active ? "bg-pa-green text-white" : "bg-pa-field text-pa-muted-2",
                    )}
                  >
                    {item.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.scoreLabel ? (
                    <span className="flex-none rounded-full bg-pa-green px-1.5 py-0.5 font-[family-name:var(--font-pa-num)] text-[10px] font-bold text-white">
                      {item.scoreLabel}
                    </span>
                  ) : item.marking ? (
                    <span className="flex-none rounded-full bg-pa-amber-tint px-1.5 py-0.5 text-[10px] font-semibold text-pa-amber">
                      Marking
                    </span>
                  ) : null}
                </a>
              </li>
            )
          })}
        </ol>
      </div>
    </nav>
  )
}
