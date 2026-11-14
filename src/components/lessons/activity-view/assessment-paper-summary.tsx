"use client"

import { useEffect, useState } from "react"

import type { LessonActivity } from "@/types"
import {
  listSuppliedImagesAction,
  readAssessmentPaperSetupAction,
  type AssessmentPaperSetup,
} from "@/lib/server-updates"

// Teacher read-only views of an assessment paper. The questions live in their
// own tables, so they are read here rather than from the activity row. A
// pupil's view gets nothing back from the (teacher-only) read and shows the
// instructions alone; the pupil experience is built separately.

function getInstructions(activity: LessonActivity): string {
  const body = (activity.body_data ?? {}) as Record<string, unknown>
  return typeof body.instructions === "string" ? body.instructions.trim() : ""
}

function useAssessmentPaperSetup(activityId: string) {
  const [setup, setSetup] = useState<AssessmentPaperSetup | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    readAssessmentPaperSetupAction(activityId)
      .then((result) => {
        if (!cancelled) setSetup(result.data ?? null)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [activityId])
  return { setup, loaded }
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

export function AssessmentPaperShortView({ activity }: { activity: LessonActivity }) {
  const { setup, loaded } = useAssessmentPaperSetup(activity.activity_id)
  const questionCount = setup?.questions.length ?? null
  const marks = setup?.maxMarks ?? (questionCount === 0 ? 0 : activity.max_marks ?? null)

  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Assessment paper</p>
      <p>
        {!loaded
          ? "Loading questions…"
          : questionCount === null
            ? "Questions unavailable."
            : questionCount === 0
              ? "No questions yet."
              : `${plural(questionCount, "question")} · ${plural(marks ?? 0, "mark")}`}
        {setup && !setup.questionPaperPath ? " · no question paper (with its front sheet)" : null}
      </p>
    </div>
  )
}

function useSuppliedImageCount(activityId: string) {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    listSuppliedImagesAction(activityId)
      .then((result) => {
        if (!cancelled) setCount(result.data ? result.data.length : null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activityId])
  return count
}

function slotSummary(setup: AssessmentPaperSetup | null): string | null {
  const slots = setup?.powerpoint?.uploadSlots ?? []
  if (slots.length === 0) return null
  return slots.map((slot) => `${slot.label} (${slot.kind}${slot.required ? "" : ", optional"})`).join(", ")
}

export function PowerPointAssessmentShortView({ activity }: { activity: LessonActivity }) {
  const { setup, loaded } = useAssessmentPaperSetup(activity.activity_id)
  const images = useSuppliedImageCount(activity.activity_id)
  const questionCount = setup?.questions.length ?? null
  const marks = setup?.maxMarks ?? (questionCount === 0 ? 0 : activity.max_marks ?? null)
  const slots = slotSummary(setup)

  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">PowerPoint assessment</p>
      <p>
        {!loaded
          ? "Loading questions…"
          : questionCount === null
            ? "Questions unavailable."
            : questionCount === 0
              ? "No questions yet."
              : `${plural(questionCount, "question")} · ${plural(marks ?? 0, "mark")}`}
        {images !== null ? ` · ${plural(images, "supplied image")}` : null}
      </p>
      {slots ? <p className="text-xs">Pupils hand in: {slots}</p> : null}
      {setup?.powerpoint?.bodyProblem ? (
        <p className="text-xs text-destructive">Upload slots not set up: {setup.powerpoint.bodyProblem}</p>
      ) : null}
    </div>
  )
}

export function AssessmentPaperPresentView({ activity }: { activity: LessonActivity }) {
  const { setup } = useAssessmentPaperSetup(activity.activity_id)
  const instructions = getInstructions(activity)

  return (
    <div className="space-y-4">
      {instructions ? <p className="whitespace-pre-wrap text-foreground">{instructions}</p> : null}
      {setup ? (
        setup.questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No questions yet.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {plural(setup.questions.length, "question")} · {plural(setup.maxMarks, "mark")} ·{" "}
              {setup.powerpoint
                ? `${plural(setup.powerpoint.pupilsWithFiles, "pupil")} with files, ${setup.powerpoint.handedIn} handed in`
                : `${plural(setup.scriptsCount, "script")} uploaded`}
            </p>
            {slotSummary(setup) ? (
              <p className="text-xs text-muted-foreground">Pupils hand in: {slotSummary(setup)}</p>
            ) : null}
            <ol className="divide-y divide-border rounded-md border border-border">
              {setup.questions.map((question) => (
                <li key={question.questionId} className="space-y-1 px-3 py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-foreground">
                      {question.label}
                      {question.questionText ? (
                        <span className="font-normal text-muted-foreground"> {question.questionText}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{plural(question.maxMarks, "mark")}</span>
                  </div>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {question.criteria.map((criterion) => (
                      <li key={criterion.successCriteriaId}>
                        {criterion.description || "Success criterion"} ({criterion.maxMarks})
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        )
      ) : null}
    </div>
  )
}
