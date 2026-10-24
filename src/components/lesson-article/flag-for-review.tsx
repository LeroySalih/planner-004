"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Flag } from "lucide-react"
import { toggleSubmissionFlagAction } from "@/lib/server-updates"
import { cn } from "@/lib/utils"

/**
 * Lets a pupil ask their teacher to look at a marked answer again. Shown in
 * the feedback, after the model answer, once feedback has been released.
 */
export function FlagForReview({ submissionId, isFlagged: initialFlagged }: { submissionId: string; isFlagged: boolean }) {
  const [isFlagged, setIsFlagged] = useState(initialFlagged)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    const next = !isFlagged
    setIsFlagged(next)
    startTransition(async () => {
      const result = await toggleSubmissionFlagAction({ submissionId, isFlagged: next })
      if (!result.success) {
        setIsFlagged(!next)
        toast.error("Unable to update flag status.")
      }
    })
  }

  return (
    <div className="mt-3 border-t border-la-border pt-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={isFlagged}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 text-sm",
          isFlagged ? "font-medium text-la-red" : "text-la-muted hover:text-la-ink",
        )}
      >
        <Flag className="h-4 w-4" aria-hidden="true" />
        {isFlagged ? "Flagged for your teacher to check. Unflag" : "Flag this answer for your teacher to check again"}
      </button>
    </div>
  )
}
