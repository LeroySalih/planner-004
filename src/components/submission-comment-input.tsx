"use client"

import { useState, useTransition } from "react"
import { addSubmissionCommentAction } from "@/lib/server-updates"
import { toast } from "sonner"

type Props = {
  submissionId: string
}

export function SubmissionCommentInput({ submissionId }: Props) {
  const [comment, setComment] = useState("")
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return

    startTransition(async () => {
      const { error } = await addSubmissionCommentAction({ submissionId, comment: comment.trim() })
      if (error) {
        toast.error(error)
      } else {
        setSent(true)
        setComment("")
        toast.success("Note sent to teacher.")
      }
    })
  }

  if (sent) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        ✓ Your note has been sent to the teacher.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Leave a note for your teacher (optional)..."
        rows={2}
        maxLength={2000}
        className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        disabled={isPending}
      />
      <button
        type="submit"
        disabled={isPending || !comment.trim()}
        className="self-end rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Send note"}
      </button>
    </form>
  )
}
