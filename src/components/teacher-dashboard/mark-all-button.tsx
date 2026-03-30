"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { markAllUnmarkedForLessonAction } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"

interface MarkAllButtonProps {
  groupId: string
  lessonId: string
}

export function MarkAllButton({ groupId, lessonId }: MarkAllButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleClick = () => {
    startTransition(async () => {
      const result = await markAllUnmarkedForLessonAction({ groupId, lessonId })

      if (!result.success) {
        toast.error(result.error ?? "Failed to queue submissions for marking.")
        return
      }

      if (result.count === 0) {
        toast.info("No unmarked submissions found.")
        return
      }

      toast.success(`Queued ${result.count} submission${result.count === 1 ? "" : "s"} for marking.`)
      router.refresh()
    })
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="mt-1.5 h-6 border-amber-300 px-2 text-xs text-amber-700 hover:border-amber-500 hover:bg-amber-100 dark:border-amber-400/30 dark:text-amber-400 dark:hover:border-amber-400 dark:hover:bg-amber-400/10"
      disabled={isPending}
      onClick={handleClick}
    >
      {isPending ? "Queuing…" : "Mark All"}
    </Button>
  )
}
