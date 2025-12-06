"use client"

import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { toast } from "sonner"

type LessonErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function LessonError({ error, reset }: LessonErrorProps) {
  useEffect(() => {
    console.error("[lessons][error boundary]", {
      message: error?.message,
      digest: error?.digest,
      stack: error?.stack,
    })
    toast.error(error?.message ?? "Lesson page failed to load.")
  }, [error])

  return (
    <div className="container mx-auto flex min-h-[50vh] flex-col items-start gap-3 p-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <h1 className="text-xl font-semibold text-destructive">Lesson page failed to load</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        {error?.message ?? "Something went wrong while rendering this lesson."}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
      >
        Try again
      </button>
    </div>
  )
}
