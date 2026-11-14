"use client"

import { useRef, useState } from "react"
import { format, parseISO } from "date-fns"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { handInPowerPointAssessmentAction } from "@/lib/server-updates"
import type {
  AssessmentEvidenceImage,
  PowerPointResultFile,
  PowerPointResultFiles,
} from "@/lib/assessment-paper/results"

// The parts of a PowerPoint assessment's results panel a paper does not have:
// the pupil's files in place of the script, the pictures the marker was given
// for a task, and the marker's own note on the evidence. Teacher views only.

/** An upload time as dd-MM-yyyy HH:mm. */
export function formatUploadedAt(iso: string) {
  try {
    return format(parseISO(iso), "dd-MM-yyyy HH:mm")
  } catch {
    return iso
  }
}

const ACCEPT: Record<PowerPointResultFile["kind"], string> = {
  pptx: ".pptx",
  pdf: ".pdf,application/pdf",
  docx: ".docx",
}

/**
 * The pupil's files, one per upload slot, with what the reader made of each,
 * and a teacher's upload or replacement of a slot's file. After hand-in a
 * replacement clears what was marked from the old file (the teacher's own
 * marks are kept) and sends the work for marking again. Before hand-in, once
 * every required slot has a file, the teacher can hand in for the pupil.
 */
export function PowerPointFilesBlock({
  activityId,
  pupilId,
  files,
  markStatusLine,
  onChanged,
}: {
  activityId: string
  pupilId: string
  files: PowerPointResultFiles
  /** Where marking has got to, already worded. */
  markStatusLine: string | null
  onChanged: () => Promise<void>
}) {
  const [busySlot, setBusySlot] = useState<string | null>(null)
  const [handingIn, setHandingIn] = useState(false)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const canHandIn = !files.handedIn && files.files.every((slot) => !slot.required || Boolean(slot.name))

  const handIn = async () => {
    if (!window.confirm("Hand in this pupil's files? They are sent for marking and the pupil can no longer change them.")) {
      return
    }
    setHandingIn(true)
    try {
      const result = await handInPowerPointAssessmentAction(activityId, pupilId)
      if (result.error || !result.data) {
        toast.error("Not handed in", { description: result.error ?? "Please try again." })
        return
      }
      toast.success(
        result.data.alreadyHandedIn ? "The pupil had already handed in." : "Handed in for the pupil and sent for marking.",
      )
      await onChanged()
    } catch (error) {
      toast.error("Not handed in", { description: error instanceof Error ? error.message : "Please try again." })
    } finally {
      setHandingIn(false)
    }
  }

  const upload = async (slot: PowerPointResultFile, file: File) => {
    setBusySlot(slot.slotKey)
    try {
      const formData = new FormData()
      formData.set("activityId", activityId)
      formData.set("pupilId", pupilId)
      formData.set("slotKey", slot.slotKey)
      formData.set("file", file)
      const response = await fetch("/api/pupil-submission/practical", { method: "POST", body: formData })
      const json = (await response.json().catch(() => null)) as
        | { success: boolean; error?: string; data?: { file: { requeued: boolean } } }
        | null
      if (!response.ok || !json?.success) {
        toast.error(`${slot.label} not uploaded`, { description: json?.error ?? "Please try again." })
        return
      }
      toast.success(
        json.data?.file.requeued
          ? `${slot.label} replaced. It is sent for marking again in two minutes.`
          : `${slot.label} uploaded for the pupil.`,
      )
      await onChanged()
    } catch (error) {
      toast.error(`${slot.label} not uploaded`, { description: error instanceof Error ? error.message : "Please try again." })
    } finally {
      setBusySlot(null)
    }
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pupil&apos;s files</p>
        <span className="text-xs text-muted-foreground">{files.handedIn ? "Handed in" : "Not handed in"}</span>
      </div>
      <ul className="mt-1 space-y-2">
        {files.files.map((slot) => (
          <li key={slot.slotKey} className="text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-foreground">{slot.label}</span>
              {slot.required ? <Badge variant="outline" className="text-[10px]">Required</Badge> : null}
              {slot.url && slot.name ? (
                <a href={slot.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                  {slot.name}
                </a>
              ) : (
                <span className={slot.required ? "text-destructive" : "text-muted-foreground"}>Not handed in</span>
              )}
              <button
                type="button"
                disabled={busySlot !== null || handingIn}
                onClick={() => inputs.current[slot.slotKey]?.click()}
                className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                title={
                  files.handedIn
                    ? "Replace the pupil's file: what was marked from the old one is cleared (your marks are kept) and it is marked again"
                    : "Upload this file for the pupil"
                }
              >
                {busySlot === slot.slotKey ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                {slot.name ? "Replace" : "Upload"}
              </button>
              <input
                ref={(element) => {
                  inputs.current[slot.slotKey] = element
                }}
                type="file"
                accept={ACCEPT[slot.kind]}
                className="hidden"
                aria-label={`Upload ${slot.label} for the pupil`}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ""
                  if (file) void upload(slot, file)
                }}
              />
            </div>
            {slot.uploadedAt ? (
              <p className="text-muted-foreground">
                Uploaded {formatUploadedAt(slot.uploadedAt)}
                {slot.evidenceStatus === "ok" ? " · read" : slot.evidenceStatus === null ? " · not read yet" : ""}
              </p>
            ) : null}
            {slot.evidenceStatus === "error" ? (
              <p className="text-destructive">Could not be read: {slot.evidenceError ?? "the reader refused this file."}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {files.missingHeadings.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Headings not found in the evidence document: {files.missingHeadings.join(", ")}.
        </p>
      ) : null}
      {files.warnings.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {files.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {files.unplacedImages.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">
            Pictures outside every heading (kept for you, never marked):
          </p>
          <EvidenceThumbnails images={files.unplacedImages} />
        </div>
      ) : null}
      {canHandIn ? (
        <button
          type="button"
          disabled={handingIn || busySlot !== null}
          onClick={() => void handIn()}
          className="mt-2 inline-flex items-center gap-1 rounded border border-primary bg-primary px-2 py-0.5 text-xs text-primary-foreground disabled:opacity-50"
          title="Hand in the files above for the pupil: they are sent for marking"
        >
          {handingIn ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          Hand in for pupil
        </button>
      ) : null}
      {markStatusLine ? <p className="mt-2 text-xs text-muted-foreground">{markStatusLine}</p> : null}
    </div>
  )
}

/** Small pictures; one opens full size. */
export function EvidenceThumbnails({ images }: { images: AssessmentEvidenceImage[] }) {
  const [open, setOpen] = useState<AssessmentEvidenceImage | null>(null)
  if (images.length === 0) return null
  return (
    <>
      <div className="mt-1 flex flex-wrap gap-2">
        {images.map((image, index) => (
          <button
            key={`${index}-${image.url}`}
            type="button"
            onClick={() => setOpen(image)}
            className="overflow-hidden rounded border border-border bg-background hover:ring-2 hover:ring-primary/40"
            title={`${image.caption}: click to enlarge`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated /api/files picture */}
            <img src={image.url} alt={image.caption} loading="lazy" className="h-16 w-auto max-w-[8rem] object-contain" />
          </button>
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={(next) => (next ? null : setOpen(null))}>
        <DialogContent className="max-w-5xl">
          <DialogTitle className="text-sm">{open?.caption}</DialogTitle>
          <DialogDescription className="sr-only">The picture full size.</DialogDescription>
          {open ? (
            // eslint-disable-next-line @next/next/no-img-element -- an authenticated /api/files picture
            <img src={open.url} alt={open.caption} className="max-h-[80vh] w-full object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The marker's note on the evidence it used: for the teacher, never the pupil. */
export function MarkerEvidenceNote({ text }: { text: string }) {
  return (
    <details className="mt-2 rounded border border-dashed border-border px-2 py-1 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground">Marker&apos;s note (teacher only)</summary>
      <p className="mt-1 whitespace-pre-line text-foreground">{text}</p>
    </details>
  )
}
