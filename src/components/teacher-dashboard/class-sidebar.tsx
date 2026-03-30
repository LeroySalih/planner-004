"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

type ClassItem = {
  groupId: string
  subject: string
}

export function ClassSidebar({ classes }: { classes: ClassItem[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeClass = searchParams.get("class") ?? null

  function select(groupId: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (groupId) {
      params.set("class", groupId)
    } else {
      params.delete("class")
    }
    router.push(`/?${params.toString()}`)
  }

  return (
    <nav className="flex w-44 shrink-0 flex-col overflow-y-auto border-r border-border bg-card">
      <span className="px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Classes
      </span>
      <button
        type="button"
        onClick={() => select(null)}
        className={cn(
          "px-3 py-2 text-left text-sm transition-colors",
          activeClass === null
            ? "bg-accent font-semibold text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
      >
        All
      </button>
      {classes.map((c) => (
        <button
          key={c.groupId}
          type="button"
          onClick={() => select(c.groupId)}
          className={cn(
            "px-3 py-2 text-left text-sm transition-colors",
            activeClass === c.groupId
              ? "bg-accent font-semibold text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {c.groupId}
        </button>
      ))}
    </nav>
  )
}
