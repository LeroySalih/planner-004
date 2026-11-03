"use client"

import { useOptimistic, useTransition } from "react"
import { FileText, GalleryVertical, Loader2, type LucideIcon } from "lucide-react"
import { toast } from "sonner"

import type { LessonViewMode } from "@/types"
import { setLessonViewModeAction } from "@/lib/server-updates"
import { cn } from "@/lib/utils"

const OPTIONS: Array<{ mode: LessonViewMode; label: string; icon: LucideIcon }> = [
  { mode: "page", label: "Page", icon: FileText },
  { mode: "slides", label: "Slides", icon: GalleryVertical },
]

/**
 * Chooses how the viewer's lessons are laid out: as one page, or as slides
 * (one activity per screen). Saved on their profile, so the server renders the
 * chosen layout on every device; saving revalidates the lesson page.
 */
export function LessonViewSwitch({ mode, className }: { mode: LessonViewMode; className?: string }) {
  const [shownMode, setShownMode] = useOptimistic(mode)
  const [pending, startTransition] = useTransition()

  const choose = (next: LessonViewMode) => {
    if (next === shownMode) return
    startTransition(async () => {
      setShownMode(next)
      const result = await setLessonViewModeAction(next)
      if (result.error) toast.error(result.error)
    })
  }

  return (
    <div
      role="group"
      aria-label="Lesson layout"
      aria-busy={pending}
      className={cn("inline-flex rounded-lg border border-border bg-muted p-0.5 text-sm", className)}
    >
      {OPTIONS.map(({ mode: option, label, icon: Icon }) => {
        const selected = shownMode === option
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => choose(option)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {pending && selected ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Icon className="h-4 w-4" aria-hidden="true" />
            )}
            {label}
          </button>
        )
      })}
    </div>
  )
}
