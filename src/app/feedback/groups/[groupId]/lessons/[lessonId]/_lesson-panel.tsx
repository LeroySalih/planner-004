"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

type LessonPanelProps = {
  lesson: {
    lesson_id: string
    title: string
    unit_id: string
    order_by: number | null
    active: boolean | null
  }
}

export function LessonDetailsPanel({ lesson }: LessonPanelProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-medium text-foreground transition hover:bg-muted/60"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {lesson.title}
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
            lesson.active ?? true
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {(lesson.active ?? true) ? "Active" : "Inactive"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-border px-5 py-4 text-sm">
          <dl className="space-y-2">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Lesson ID</dt>
              <dd className="font-medium text-foreground">{lesson.lesson_id}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Unit</dt>
              <dd className="font-medium text-foreground">{lesson.unit_id}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Order</dt>
              <dd className="font-medium text-foreground">{lesson.order_by ?? "—"}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  )
}
