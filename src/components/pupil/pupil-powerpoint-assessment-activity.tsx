"use client"

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react"
import { format, parseISO } from "date-fns"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useFeedbackVisibility } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type {
  PupilPowerPointCriterionComment,
  PupilPowerPointSlot,
  PupilPowerPointView,
} from "@/lib/powerpoint-assessment/pupil-view"
import {
  handInPowerPointAssessmentAction,
  readMyPowerPointAssessmentViewAction,
  removePracticalFileAction,
} from "@/lib/server-actions/powerpoint-assessment"
import { cn } from "@/lib/utils"

interface PupilPowerPointAssessmentActivityProps {
  activityId: string
  pupilId: string
  viewerIsTeacher: boolean
  /** The viewer is this pupil (or a teacher previewing as themselves) and the lesson is not locked. */
  canWork: boolean
  groupAssignmentId: string | null
  /** Loaded on the server (readPupilPowerPointView); feedback only when visible to the viewer. */
  initialView: PupilPowerPointView
}

/** Mirrors PRACTICAL_UPLOAD_MAX_BYTES; the server checks again. */
const MAX_BYTES = 25 * 1024 * 1024

const ACCEPT: Record<PupilPowerPointSlot["kind"], string> = {
  pptx: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: ".pdf,application/pdf",
  docx: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
const KIND_NAME: Record<PupilPowerPointSlot["kind"], string> = {
  pptx: "a PowerPoint .pptx file",
  pdf: "a PDF",
  docx: "a Word .docx file",
}

const LINK_CLASS =
  "inline-flex min-h-11 items-center text-sm font-semibold text-la-green hover:text-la-green-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-la-green"
const BUTTON_CLASS =
  "inline-flex min-h-11 items-center gap-2 rounded-md border border-la-border bg-la-card px-3 text-sm font-semibold text-la-ink hover:border-la-green disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-la-green"

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function formatWhen(iso: string) {
  try {
    return format(parseISO(iso), "dd-MM-yyyy HH:mm")
  } catch {
    return iso
  }
}

function joinLabels(labels: string[]) {
  if (labels.length <= 1) return labels.join("")
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase()
}

/**
 * A PowerPoint assessment on the pupil's lesson page: the task and the files
 * it needs, one upload per file the pupil hands in, and Hand in, which starts
 * the marking. After hand-in the files are read-only here (a teacher can
 * still change them from the results page). Once the lesson's feedback is
 * released: the total, the teacher's comment and the feedback task by task.
 */
export function PupilPowerPointAssessmentActivity({
  activityId,
  pupilId,
  viewerIsTeacher,
  canWork,
  groupAssignmentId,
  initialView,
}: PupilPowerPointAssessmentActivityProps) {
  const { currentVisible } = useFeedbackVisibility()
  const visible = currentVisible || viewerIsTeacher
  const [view, setView] = useState<PupilPowerPointView>(initialView)
  const [busySlot, setBusySlot] = useState<string | null>(null)
  const [handingIn, setHandingIn] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loadingFeedback, setLoadingFeedback] = useState(false)

  const refresh = useCallback(async () => {
    const result = await readMyPowerPointAssessmentViewAction(activityId, pupilId)
    if (result.data) setView(result.data)
    else if (result.error) toast.error("Unable to refresh this task", { description: result.error })
  }, [activityId, pupilId])

  // Released while the page is open: fetch the feedback now. The server checks again.
  useEffect(() => {
    if (!visible || !view.handedIn || view.feedback) return
    let cancelled = false
    setLoadingFeedback(true)
    readMyPowerPointAssessmentViewAction(activityId, pupilId)
      .then((result) => {
        if (!cancelled && result.data) setView(result.data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingFeedback(false)
      })
    return () => {
      cancelled = true
    }
  }, [visible, view.handedIn, view.feedback, activityId, pupilId])

  const editable = canWork && !view.handedIn && !view.notSetUp
  const busy = busySlot !== null || handingIn

  const uploadFile = async (slot: PupilPowerPointSlot, file: File) => {
    if (extensionOf(file.name) !== slot.kind) {
      toast.error(`${slot.label} must be ${KIND_NAME[slot.kind]}`, { description: `${file.name} is not.` })
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error(`${file.name} is too large`, { description: "Files must be 25 MB or smaller." })
      return
    }
    setBusySlot(slot.key)
    try {
      const formData = new FormData()
      formData.append("activityId", activityId)
      formData.append("slotKey", slot.key)
      formData.append("pupilId", pupilId)
      formData.append("file", file)
      if (groupAssignmentId) formData.append("groupAssignmentId", groupAssignmentId)
      const response = await fetch("/api/pupil-submission/practical", { method: "POST", body: formData })
      const payload = (await response.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!response.ok || !payload?.success) {
        toast.error(`Upload failed for ${file.name}`, { description: payload?.error ?? "Please try again." })
        return
      }
      toast.success(`Uploaded ${file.name}`)
      await refresh()
    } catch {
      toast.error(`Upload failed for ${file.name}`, { description: "Network error, please try again." })
    } finally {
      setBusySlot(null)
    }
  }

  const removeFile = async (slot: PupilPowerPointSlot) => {
    setBusySlot(slot.key)
    try {
      const result = await removePracticalFileAction(activityId, pupilId, slot.key, groupAssignmentId)
      if (result.error) {
        toast.error("Unable to remove the file", { description: result.error })
        return
      }
      toast.success(`Removed ${slot.file?.name ?? "the file"}`)
      await refresh()
    } catch {
      toast.error("Unable to remove the file", { description: "Network error, please try again." })
    } finally {
      setBusySlot(null)
    }
  }

  const handIn = async () => {
    setHandingIn(true)
    try {
      const result = await handInPowerPointAssessmentAction(activityId, pupilId, groupAssignmentId)
      if (result.error) {
        toast.error("Unable to hand in", { description: result.error })
        return
      }
      toast.success("Handed in", { description: "Your work has been sent for marking." })
      setConfirmOpen(false)
      await refresh()
    } catch {
      toast.error("Unable to hand in", { description: "Network error, please try again." })
    } finally {
      setHandingIn(false)
    }
  }

  const feedback = visible ? view.feedback : null
  const hasDownloads = view.questionPaperUrl || view.downloads.length > 0 || view.suppliedImages.length > 0

  return (
    <div className="space-y-5 text-[15px] leading-relaxed text-la-ink">
      {view.instructions ? <p className="whitespace-pre-line">{view.instructions}</p> : null}

      {hasDownloads ? (
        <section aria-label="Files you need" className="space-y-1">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-la-muted">Files you need</h4>
          <ul className="flex flex-wrap gap-x-5">
            {view.questionPaperUrl ? (
              <li>
                <a href={view.questionPaperUrl} target="_blank" rel="noreferrer" className={LINK_CLASS}>
                  Question paper
                </a>
              </li>
            ) : null}
            {view.downloads.map((file) => (
              <li key={`file-${file.name}`}>
                <a href={file.url} download={file.name} className={LINK_CLASS}>
                  {file.name}
                </a>
              </li>
            ))}
          </ul>
          {view.suppliedImages.length > 0 ? (
            <div>
              <p className="text-sm text-la-muted">Images to use</p>
              <ul className="flex flex-wrap gap-x-5">
                {view.suppliedImages.map((image) => (
                  <li key={`image-${image.url}`}>
                    <a href={image.url} download={image.name} className={LINK_CLASS}>
                      {image.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : view.downloadsBlocked ? (
        <p className="text-sm text-la-muted">Downloads are switched off while this lesson is locked.</p>
      ) : null}

      {view.notSetUp ? (
        <p className="rounded-[10px] border border-dashed border-la-input p-4 text-sm text-la-muted">
          This task is not ready yet. Please let your teacher know.
        </p>
      ) : (
        <section aria-label="Your files" className="space-y-3">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-la-muted">Your files</h4>
          <ul className="space-y-3">
            {view.slots.map((slot) => (
              <SlotRow
                key={slot.key}
                slot={slot}
                editable={editable}
                busy={busySlot === slot.key}
                disabled={busy}
                onUpload={(file) => void uploadFile(slot, file)}
                onRemove={() => void removeFile(slot)}
              />
            ))}
          </ul>
        </section>
      )}

      {!view.notSetUp ? <HandInStatus view={view} /> : null}

      {editable ? (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy || view.missingRequired.length > 0}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-la-green px-4 text-sm font-semibold text-white hover:bg-la-green-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-la-green"
          >
            {handingIn ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Hand in
          </button>
          {view.missingRequired.length > 0 ? (
            <p className="text-sm text-la-muted">Upload {joinLabels(view.missingRequired)} before handing in.</p>
          ) : null}
        </div>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !handingIn && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hand in your work?</AlertDialogTitle>
            <AlertDialogDescription>
              Your files are sent for marking. After you hand in you can&apos;t change them; ask your teacher if
              you need to.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={handingIn}>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={handingIn}
              onClick={(event) => {
                event.preventDefault()
                void handIn()
              }}
            >
              {handingIn ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Hand in
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {loadingFeedback && !feedback ? <p className="text-sm text-la-muted">Loading your feedback…</p> : null}

      {feedback ? (
        <section
          aria-label="Your feedback"
          className="space-y-3 rounded-[10px] border border-la-border bg-la-green-pale/60 p-4"
        >
          {viewerIsTeacher && !currentVisible ? (
            <p className="text-sm font-semibold text-la-amber">
              Preview: pupils can&apos;t see this until you release feedback.
            </p>
          ) : null}
          <p className="font-semibold">
            {feedback.marksAwarded === null
              ? "Not marked yet"
              : `${feedback.marksAwarded} / ${feedback.maxMarks} marks`}
          </p>
          {feedback.teacherComment ? <p className="whitespace-pre-line">{feedback.teacherComment}</p> : null}
          {feedback.feedbackPdfUrl ? (
            <a href={feedback.feedbackPdfUrl} className={LINK_CLASS}>
              Download your feedback (PDF)
            </a>
          ) : null}
          <ol className="divide-y divide-la-border border-t border-la-border">
            {feedback.questions.map((question) => (
              <li key={question.label} className="py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="font-semibold">
                    {question.label}
                    {question.questionText ? (
                      <span className="ml-2 font-normal text-la-muted">{question.questionText}</span>
                    ) : null}
                  </p>
                  <span className="flex-none text-sm font-semibold">
                    {question.awarded === null ? "Not marked" : `${question.awarded} / ${question.available}`}
                  </span>
                </div>
                {question.comments.length > 0 ? (
                  <ul className="mt-1 space-y-1 text-sm">
                    {question.comments.map((comment, index) => (
                      <CommentLine key={index} comment={comment} />
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  )
}

function CommentLine({ comment }: { comment: PupilPowerPointCriterionComment }) {
  if (comment.source === "teacher") {
    return <li className="whitespace-pre-line">{comment.text}</li>
  }
  return (
    <li className="space-y-0.5">
      {comment.whyNotAwarded ? <p className="whitespace-pre-line">{comment.whyNotAwarded}</p> : null}
      {comment.howToImprove ? (
        <p className="whitespace-pre-line">
          <span className="font-semibold">To improve: </span>
          {comment.howToImprove}
        </p>
      ) : null}
    </li>
  )
}

function HandInStatus({ view }: { view: PupilPowerPointView }) {
  if (!view.handedIn) return null
  const readErrors = view.slots.filter((slot) => slot.file?.readError)
  const message =
    view.markState === "waiting"
      ? "Waiting to be marked."
      : view.markState === "marked"
        ? view.feedback
          ? "Marked."
          : "Marked. Your teacher will share your feedback."
        : readErrors.length > 0
          ? `Your teacher needs to look at ${readErrors.length === 1 ? "a file" : "some files"} before your work is marked.`
          : "Your teacher needs to look at your work before it is marked."
  return (
    <p
      role="status"
      className={cn(
        "rounded-[10px] border p-3 text-sm",
        view.markState === "held" ? "border-la-amber bg-la-amber-bg text-la-amber" : "border-la-border bg-la-card",
      )}
    >
      <span className="font-semibold">Handed in.</span> {message}
    </p>
  )
}

function SlotRow({
  slot,
  editable,
  busy,
  disabled,
  onUpload,
  onRemove,
}: {
  slot: PupilPowerPointSlot
  editable: boolean
  busy: boolean
  disabled: boolean
  onUpload: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const inputId = `practical-${slot.key}`

  const onDrop = (event: DragEvent<HTMLLIElement>) => {
    if (!editable) return
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    const file = event.dataTransfer.files?.[0]
    if (file) onUpload(file)
  }

  return (
    <li
      onDragOver={(event) => {
        if (!editable) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "rounded-[10px] border bg-la-card p-3",
        dragging ? "border-la-green border-dashed" : "border-la-border",
        slot.file?.readError && "border-la-red",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-semibold">
          {slot.label}
          <span className="ml-2 text-sm font-normal text-la-muted">
            {slot.kind === "pptx" ? ".pptx" : slot.kind === "pdf" ? "PDF" : ".docx"}
            {slot.required ? " · required" : " · if you have one"}
          </span>
        </p>
      </div>
      {slot.hint ? <p className="mt-0.5 text-sm text-la-muted">{slot.hint}</p> : null}

      {slot.file ? (
        <p className="mt-1 text-sm">
          {slot.file.url ? (
            <a href={slot.file.url} download={slot.file.name} className="font-medium text-la-green hover:text-la-green-hover">
              {slot.file.name}
            </a>
          ) : (
            <span className="font-medium">{slot.file.name}</span>
          )}
          <span className="text-la-muted">
            {" "}
            · {formatBytes(slot.file.bytes)} · uploaded {formatWhen(slot.file.uploadedAt)}
          </span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-la-muted">{editable ? "No file yet." : "No file handed in."}</p>
      )}

      {slot.file?.readError ? (
        <p className="mt-2 rounded-md bg-la-red-bg p-2 text-sm text-la-red">
          This file could not be read: {slot.file.readError}
        </p>
      ) : null}

      {editable ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPT[slot.kind]}
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (file) onUpload(file)
            }}
          />
          <button type="button" className={BUTTON_CLASS} disabled={disabled} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {slot.file ? "Replace" : "Upload"}
          </button>
          {slot.file ? (
            <button type="button" className={BUTTON_CLASS} disabled={disabled} onClick={onRemove}>
              Remove
            </button>
          ) : null}
          <span className="text-xs text-la-muted">or drop {KIND_NAME[slot.kind]} here</span>
        </div>
      ) : null}
    </li>
  )
}
