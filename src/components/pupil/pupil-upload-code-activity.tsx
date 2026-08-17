"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { readMyCodeSubmissionAction, submitCodeAction } from "@/lib/server-actions/upload-code"

interface PupilUploadCodeActivityProps {
  activityId: string
  language: string
  starterCode: string
  assignmentId: string | null
  /** Pre-highlighted HTML for the last submission, rendered on the server. */
  submittedHtml?: string | null
  readOnly?: boolean
}

/**
 * Pupil-facing editor for an upload-code activity.
 *
 * A plain textarea rather than a full editor component: it needs to accept
 * pasted source, preserve indentation, and nothing more. Highlighting is
 * applied to the SUBMITTED code (server-rendered) — highlighting while typing
 * would mean shipping a highlighter to the browser and fighting the CSP for no
 * teaching benefit.
 */
export function PupilUploadCodeActivity({
  activityId,
  language,
  starterCode,
  assignmentId,
  submittedHtml,
  readOnly = false,
}: PupilUploadCodeActivityProps) {
  const [code, setCode] = useState(starterCode)
  const [loaded, setLoaded] = useState(false)
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    void readMyCodeSubmissionAction(activityId).then((result) => {
      if (cancelled) return
      if (result.data?.code) {
        setCode(result.data.code)
        setSubmittedAt(result.data.submittedAt)
      }
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [activityId])

  /**
   * Tab inserts four spaces instead of moving focus. Without this, Python is
   * effectively untypable in a textarea — the first Tab jumps to the next
   * control and the pupil loses their place.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab") return
    event.preventDefault()
    const el = event.currentTarget
    const { selectionStart, selectionEnd } = el
    const next = `${code.slice(0, selectionStart)}    ${code.slice(selectionEnd)}`
    setCode(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 4
    })
  }

  const submit = () => {
    if (code.trim().length === 0) {
      toast.error("Write some code before submitting.")
      return
    }
    startTransition(async () => {
      const result = await submitCodeAction({ activityId, code, assignmentId })
      if (!result.success) {
        toast.error(result.error ?? "Unable to submit your code.")
        return
      }
      setSubmittedAt(new Date().toISOString())
      toast.success("Submitted. Your work is being marked.")
    })
  }

  if (readOnly) {
    return submittedHtml ? (
      <pre className="hljs overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
        <code dangerouslySetInnerHTML={{ __html: submittedHtml }} />
      </pre>
    ) : (
      <p className="text-sm text-muted-foreground">No code submitted yet.</p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your {language} solution
        </span>
        {submittedAt ? (
          <span className="text-xs text-muted-foreground">Submitted</span>
        ) : null}
      </div>

      <textarea
        ref={textareaRef}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isPending || !loaded}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={16}
        placeholder={`Write or paste your ${language} here…`}
        className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      />

      <div className="flex items-center gap-3">
        <Button type="button" onClick={submit} disabled={isPending || !loaded}>
          {isPending ? "Submitting…" : submittedAt ? "Resubmit" : "Submit solution"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Your teacher&apos;s marker will comment on your code — it will not write the answer for you.
        </span>
      </div>
    </div>
  )
}
