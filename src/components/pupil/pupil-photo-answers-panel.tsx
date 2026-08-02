"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  extractPhotoAnswersAction,
  submitPhotoAnswersAction,
  type PhotoExtractResult,
} from "@/lib/server-actions/photo-answers"
import type { ExtractedAnswer } from "@/lib/ai/photo-answers"

async function fileToJpeg(file: File, max = 1600): Promise<{ mimeType: string; base64: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h)
  return { mimeType: "image/jpeg", base64: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "" }
}

type Draft = Record<string, ExtractedAnswer>

export function PupilPhotoAnswersPanel({
  lessonId,
  assignmentId,
  onClose,
  onSubmitted,
}: {
  lessonId: string
  assignmentId?: string
  onClose: () => void
  onSubmitted: () => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [extracted, setExtracted] = useState<PhotoExtractResult | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [done, setDone] = useState<Set<string>>(new Set())

  const extract = async () => {
    setBusy(true)
    try {
      const images = await Promise.all(files.map((f) => fileToJpeg(f)))
      const res = await extractPhotoAnswersAction({ lessonId, images })
      if (!res.success) {
        toast.error("Couldn't read the photo", { description: res.error ?? "Try again." })
        return
      }
      setExtracted(res)
      setDraft(Object.fromEntries(res.answers.map((a) => [a.activityId, a])))
      if (res.message) toast.message(res.message)
    } catch (e) {
      toast.error("Couldn't read the photo", { description: e instanceof Error ? e.message : "Try again." })
    } finally {
      setBusy(false)
    }
  }

  const edit = (activityId: string, patch: Partial<ExtractedAnswer>) =>
    setDraft((d) => ({ ...d, [activityId]: { ...d[activityId], ...patch } as ExtractedAnswer }))

  const submitAll = async () => {
    const answers = Object.values(draft).filter((a) => !done.has(a.activityId) && hasAnswer(a))
    if (answers.length === 0) {
      toast.message("No answers to submit yet.")
      return
    }
    setBusy(true)
    try {
      const res = await submitPhotoAnswersAction({ lessonId, assignmentId, answers })
      const ok = res.results.filter((r) => r.success).map((r) => r.activityId)
      const fail = res.results.filter((r) => !r.success)
      setDone((prev) => new Set([...prev, ...ok]))
      if (ok.length) toast.success(`Submitted ${ok.length} answer${ok.length > 1 ? "s" : ""}`)
      fail.forEach((f) => toast.error(`Couldn't submit one answer`, { description: f.error ?? "" }))
      if (ok.length) onSubmitted()
    } catch (e) {
      toast.error("Submit failed", { description: e instanceof Error ? e.message : "Try again." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-lg flex-col border-l bg-white dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Answer from a photo</h2>
          <button onClick={onClose} className="text-sm text-gray-500">Close</button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!extracted ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Do the questions on paper, then upload a photo of your work. We&apos;ll read your answers so you can check and submit them.
              </p>
              <input type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif" multiple
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="block w-full text-sm" />
              <button onClick={extract} disabled={busy || files.length === 0}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Reading…" : "Read my answers"}
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300">Check each answer, edit if needed, then submit.</p>
              {extracted.activities.map((act) => {
                const a = draft[act.activityId]
                const conf = a?.confidence ?? 0
                const low = conf > 0 && conf < 0.75
                const isDone = done.has(act.activityId)
                return (
                  <div key={act.activityId} className={`rounded-lg border p-3 text-sm ${isDone ? "opacity-60" : ""}`}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">{act.type}</span>
                      {isDone ? <span className="text-[10px] font-semibold text-emerald-700">✓ submitted</span>
                        : low ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">check this</span>
                        : conf === 0 ? <span className="text-[10px] text-gray-400">no answer found</span> : null}
                    </div>
                    <p className="font-medium">{act.question}</p>
                    <div className="mt-2">{renderEditor(act, a, (patch) => edit(act.activityId, patch), isDone)}</div>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {extracted ? (
          <div className="border-t p-3">
            <button onClick={submitAll} disabled={busy}
              className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Submitting…" : "Submit all answered"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function hasAnswer(a: ExtractedAnswer): boolean {
  return Boolean(a.chosenOption || a.answerText?.trim() || a.matches?.length || a.placements?.length || a.order?.length)
}

function renderEditor(
  act: PhotoExtractResult["activities"][number],
  a: ExtractedAnswer | undefined,
  onEdit: (patch: Partial<ExtractedAnswer>) => void,
  disabled: boolean,
) {
  if (act.type === "multiple-choice-question") {
    return (
      <div className="space-y-1">
        {(act.options ?? []).map((opt) => (
          <label key={opt} className="flex items-center gap-2">
            <input type="radio" name={`mcq-${act.activityId}`} checked={a?.chosenOption === opt} disabled={disabled}
              onChange={() => onEdit({ chosenOption: opt })} className="accent-emerald-600" />
            <span>{opt}</span>
          </label>
        ))}
      </div>
    )
  }
  if (act.type === "short-text-question" || act.type === "long-text-question" || act.type === "text-question") {
    return (
      <textarea value={a?.answerText ?? ""} disabled={disabled} rows={act.type === "short-text-question" ? 2 : 4}
        onChange={(e) => onEdit({ answerText: e.target.value })}
        className="w-full resize-none rounded border px-2 py-1 text-sm" placeholder="Your answer" />
    )
  }
  // matcher / group / sequence: show what was read (editable is a fast follow).
  if (a?.matches?.length) return <ul className="ml-4 list-disc text-gray-700">{a.matches.map((m, i) => <li key={i}>{m.term} → {m.definition}</li>)}</ul>
  if (a?.placements?.length) return <ul className="ml-4 list-disc text-gray-700">{a.placements.map((p, i) => <li key={i}>{p.item} → {p.group}</li>)}</ul>
  if (a?.order?.length) return <p className="text-gray-700">{a.order.join(" → ")}</p>
  return <p className="italic text-gray-400">{a?.note || "No answer found"}</p>
}
