"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"
import { readMyCodeSubmissionAction, submitCodeAction } from "@/lib/server-actions/upload-code"

/** A lesson program is a few KB; anything this big is the wrong file. */
const MAX_DROPPED_FILE_BYTES = 200 * 1024

interface PupilUploadCodeActivityProps {
  lessonId: string
  activityId: string
  language: string
  starterCode: string
  assignmentId: string | null
  /** Pre-highlighted HTML for the last submission, rendered on the server. */
  submittedHtml?: string | null
  /** The task, with fenced code blocks already highlighted on the server.
   *  Rendered here rather than as the activity heading, which strips markup
   *  and flattens a code sample onto one line. */
  taskHtml?: string | null
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
  lessonId,
  activityId,
  language,
  starterCode,
  assignmentId,
  submittedHtml,
  taskHtml,
  readOnly = false,
}: PupilUploadCodeActivityProps) {
  const [code, setCode] = useState(starterCode)
  const [loaded, setLoaded] = useState(false)
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Set as soon as the pupil types. The previous submission is fetched after
  // mount, so without this a slow response overwrites whatever they have
  // already started writing.
  const dirtyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void readMyCodeSubmissionAction(activityId).then((result) => {
      if (cancelled) return
      if (result.data?.code && !dirtyRef.current) {
        setCode(result.data.code)
      }
      if (result.data?.submittedAt) {
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
    dirtyRef.current = true
    setCode(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 4
    })
  }

  const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files")

  /**
   * A dropped .py file replaces the code in the box. Nothing is saved: the
   * pupil still presses Submit, so a wrong file costs nothing.
   */
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    setIsDragging(false)
    if (isPending || !loaded) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length !== 1) {
      toast.error("Drop one .py file at a time.")
      return
    }
    const file = files[0]
    if (!file.name.toLowerCase().endsWith(".py")) {
      toast.error("Only .py files can be dropped here.")
      return
    }
    if (file.size > MAX_DROPPED_FILE_BYTES) {
      toast.error("That file is too large to be a lesson program.")
      return
    }
    void file
      .text()
      .then((text) => {
        dirtyRef.current = true
        setCode(text.replace(/\r\n?/g, "\n"))
        toast.success(`Loaded ${file.name}. Press ${submittedAt ? "Resubmit" : "Submit solution"} to save it.`)
      })
      .catch(() => toast.error(`Unable to read ${file.name}.`))
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
      // Tells the activity header and lesson progress that this was answered.
      triggerFeedbackRefresh(lessonId, activityId)
      toast.success("Submitted. Your work is being marked.")
    })
  }

  const task = taskHtml ? (
    <div
      className="prose prose-sm max-w-none dark:prose-invert text-foreground [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/40 [&_pre]:p-3 [&_pre]:text-xs"
      dangerouslySetInnerHTML={{ __html: taskHtml }}
    />
  ) : null

  if (readOnly) {
    return (
      <div className="space-y-3">
        {task}
        {submittedHtml ? (
          <pre className="hljs overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
            <code dangerouslySetInnerHTML={{ __html: submittedHtml }} />
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">No code submitted yet.</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {task}
      {/* No status here: the activity heading's chip shows saved, awaiting
          marking and the mark, and a second label here went stale. */}
      <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Your {language} solution
      </span>

      <div
        className="relative"
        onDragOver={(event) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
          setIsDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false)
        }}
        onDrop={handleDrop}
      >
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(event) => {
            dirtyRef.current = true
            setCode(event.target.value)
          }}
          onKeyDown={handleKeyDown}
          disabled={isPending || !loaded}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={16}
          placeholder={`Write or paste your ${language} here…`}
          className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        {isDragging ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-background/90 text-sm font-medium text-foreground">
            Drop your .py file to replace the code
          </div>
        ) : null}
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">You can also drag a .py file onto the box.</p>

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
