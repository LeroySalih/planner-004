"use client"

import { useState } from "react"
import { extractPhotoAnswersAction, type PhotoExtractResult } from "@/lib/server-actions/photo-answers"

async function fileToDownscaledJpeg(file: File, max = 1600): Promise<{ mimeType: string; base64: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h)
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85)
  return { mimeType: "image/jpeg", base64: dataUrl.split(",")[1] ?? "" }
}

function AnswerView({ a }: { a: PhotoExtractResult["answers"][number] }) {
  if (a.chosenOption) return <span>Chose: <strong>{a.chosenOption}</strong></span>
  if (a.answerText) return <span>{a.answerText}</span>
  if (a.matches?.length) return <ul className="ml-4 list-disc">{a.matches.map((m, i) => <li key={i}>{m.term} → {m.definition}</li>)}</ul>
  if (a.placements?.length) return <ul className="ml-4 list-disc">{a.placements.map((p, i) => <li key={i}>{p.item} → {p.group}</li>)}</ul>
  if (a.order?.length) return <span>{a.order.join(" → ")}</span>
  return <span className="text-gray-500 italic">{a.note || "No answer found"}</span>
}

export default function PhotoAnswersTestPage() {
  const [lessonId, setLessonId] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PhotoExtractResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setError(null); setResult(null)
    try {
      const images = await Promise.all(files.map((f) => fileToDownscaledJpeg(f)))
      const res = await extractPhotoAnswersAction({ lessonId: lessonId.trim(), images })
      if (!res.success) setError(res.error)
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  const byId = new Map((result?.answers ?? []).map((a) => [a.activityId, a]))

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">Photo → answers (experiment)</h1>
      <p className="text-sm text-gray-600">Upload a photo of a pupil&apos;s handwritten answers for a lesson; the model maps each answer to an activity. Nothing is submitted here — this just proves the read/map step.</p>

      <label className="block text-sm font-medium">Lesson ID
        <input value={lessonId} onChange={(e) => setLessonId(e.target.value)} placeholder="lesson_id"
          className="mt-1 block w-full rounded border px-3 py-2 text-sm" />
      </label>

      <label className="block text-sm font-medium">Photo(s) of handwritten work
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="mt-1 block w-full text-sm" />
      </label>

      <button onClick={run} disabled={busy || !lessonId.trim() || files.length === 0}
        className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Reading…" : "Extract answers"}
      </button>

      {error ? <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {result?.message ? <p className="rounded bg-gray-50 px-3 py-2 text-sm text-gray-700">{result.message}</p> : null}

      {result?.activities?.length ? (
        <div className="space-y-2">
          {result.activities.map((act) => {
            const ans = byId.get(act.activityId)
            const conf = ans?.confidence ?? 0
            const confColor = conf >= 0.75 ? "bg-emerald-100 text-emerald-800" : conf > 0 ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"
            return (
              <div key={act.activityId} className="rounded-lg border p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">{act.type}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${confColor}`}>conf {(conf * 100).toFixed(0)}%</span>
                </div>
                <p className="font-medium text-gray-900">{act.question}</p>
                <div className="mt-1 text-gray-800">{ans ? <AnswerView a={ans} /> : <span className="italic text-gray-400">no answer extracted</span>}</div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
