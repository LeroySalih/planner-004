"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Camera } from "lucide-react"
import { PupilPhotoAnswersPanel } from "./pupil-photo-answers-panel"

/** Lesson-level entry point: pupil uploads a photo of handwritten work. */
export function PupilPhotoAnswersTrigger({ lessonId, assignmentId }: { lessonId: string; assignmentId?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-8 inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
      >
        <Camera className="h-4 w-4" />
        Upload a photo of your work
      </button>
      {open ? (
        <PupilPhotoAnswersPanel
          lessonId={lessonId}
          assignmentId={assignmentId}
          onClose={() => setOpen(false)}
          onSubmitted={() => router.refresh()}
        />
      ) : null}
    </>
  )
}
