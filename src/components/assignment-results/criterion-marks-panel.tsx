"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import {
  readActivityCriteriaForMarkingAction,
  readSubmissionScMarksAction,
  startCriteriaMarkingAction,
  updateScFeedbackAction,
  updateScMarkAction,
  type ScMarkRow,
} from "@/lib/server-actions/sc-marks"

interface CriterionMarksPanelProps {
  /** Null when the pupil has not submitted: the criteria are listed unmarked,
   *  and the first mark records a submission on their behalf. */
  submissionId: string | null
  /** Needed only when there is no submission yet. */
  newSubmission?: {
    activityId: string
    pupilId: string
    onCreated: (submissionId: string) => void
  }
  /** Called after an override so the caller can refresh its own totals. */
  onAggregateChange?: (aggregate: { awarded: number; available: number } | null) => void
  /** Reports how many criteria were found, so the caller can avoid repeating
   *  the concatenated feedback below this panel. Called with 0 when none. */
  onLoaded?: (count: number) => void
  /** The activity is marked by AI, so a teacher's mark replaces the AI's. */
  aiMarked?: boolean
}

/**
 * Per-criterion breakdown for one submission: marks, the descriptor achieved,
 * and the model's comment for that criterion.
 *
 * Teachers edit an individual criterion here; the submission total is the sum
 * of its criteria (Q7), so there is no separate whole-activity override. An
 * edited criterion is stamped `teacher` and survives a re-mark.
 */
export function CriterionMarksPanel({
  submissionId: givenSubmissionId,
  newSubmission,
  onAggregateChange,
  onLoaded,
  aiMarked = true,
}: CriterionMarksPanelProps) {
  const [marks, setMarks] = useState<ScMarkRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // The submission created by this panel's first mark. Kept here so the
  // criteria are not reloaded (and their drafts lost) when the caller learns
  // the new id.
  const createdIdRef = useRef<string | null>(null)
  // Read through a ref so a caller passing a new function each render does
  // not reload the criteria (and report again) in a loop.
  const onAggregateChangeRef = useRef(onAggregateChange)
  useEffect(() => {
    onAggregateChangeRef.current = onAggregateChange
  }, [onAggregateChange])
  const activityId = newSubmission?.activityId ?? null

  const load = useCallback(async () => {
    setLoading(true)
    const id = givenSubmissionId ?? createdIdRef.current
    const result = id
      ? await readSubmissionScMarksAction(id)
      : activityId
        ? await readActivityCriteriaForMarkingAction(activityId)
        : { data: [] }
    const next = result.data ?? []
    setMarks(next)
    setLoading(false)
    onLoaded?.(next.length)
    // Report the stored total, so a caller showing a stale one (after
    // "Refresh criteria", say) catches up.
    if (id && next.some((mark) => mark.marked)) {
      onAggregateChangeRef.current?.({
        awarded: next.reduce((sum, mark) => sum + mark.awarded, 0),
        available: next.reduce((sum, mark) => sum + mark.available, 0),
      })
    }
  }, [givenSubmissionId, activityId, onLoaded])

  useEffect(() => {
    void load()
  }, [load])

  /** The submission to mark, recording one for the pupil if there is none. */
  const resolveSubmissionId = async (): Promise<string | null> => {
    const existing = givenSubmissionId ?? createdIdRef.current
    if (existing) return existing
    if (!newSubmission) return null
    const created = await startCriteriaMarkingAction({
      activityId: newSubmission.activityId,
      pupilId: newSubmission.pupilId,
    })
    if (!created.data) {
      toast.error(created.error ?? "Unable to record a submission.")
      return null
    }
    createdIdRef.current = created.data.submissionId
    newSubmission.onCreated(created.data.submissionId)
    return created.data.submissionId
  }

  const setAwarded = (successCriteriaId: string, awarded: number) => {
    startTransition(async () => {
      const submissionId = await resolveSubmissionId()
      if (!submissionId) return
      const result = await updateScMarkAction({ submissionId, successCriteriaId, awarded })
      if (result.error) {
        toast.error(result.error)
        return
      }
      // The first mark on a submission records every criterion (the rest at
      // 0), so none is left showing "Not marked".
      setMarks((prev) =>
        prev
          ? prev.map((mark) =>
              mark.success_criteria_id === successCriteriaId
                ? {
                    ...mark,
                    marked: true,
                    awarded,
                    provenance: "teacher" as const,
                    // The AI's comment explained the previous mark, so it stops
                    // being shown the moment the teacher changes it. Mirrors
                    // effectiveCriterionFeedback on the server.
                    feedback: mark.teacher_feedback ?? null,
                  }
                : { ...mark, marked: true },
            )
          : prev,
      )
      const aggregate = result.data?.aggregate ?? null
      onAggregateChange?.(
        aggregate ? { awarded: aggregate.awarded, available: aggregate.available } : null,
      )
      toast.success("Criterion mark updated.")
    })
  }

  const saveFeedback = (successCriteriaId: string, feedback: string) => {
    startTransition(async () => {
      const submissionId = await resolveSubmissionId()
      if (!submissionId) return
      const result = await updateScFeedbackAction({ submissionId, successCriteriaId, feedback })
      if (result.error) {
        toast.error(result.error)
        return
      }
      const saved = result.data?.feedback ?? null
      setMarks((prev) =>
        prev
          ? prev.map((mark) =>
              mark.success_criteria_id === successCriteriaId
                ? { ...mark, teacher_feedback: saved, feedback: saved ?? mark.feedback }
                : mark,
            )
          : prev,
      )
      toast.success(saved ? "Comment saved." : "Comment cleared.")
    })
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading criteria…</p>
  }

  if (!marks || marks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No success criteria are linked to this activity.
      </p>
    )
  }

  const totalAwarded = marks.reduce((sum, mark) => sum + mark.awarded, 0)
  const totalAvailable = marks.reduce((sum, mark) => sum + mark.available, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-foreground">Success criteria</h4>
        <span className="text-sm font-medium text-foreground">
          {totalAwarded} / {totalAvailable}
        </span>
      </div>

      <ul className="space-y-3">
        {marks.map((mark) => (
          <li key={mark.success_criteria_id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="flex-1 text-sm text-foreground">{mark.description}</p>
              <div className="flex shrink-0 items-center gap-2">
                {!mark.marked ? (
                  <Badge variant="outline" className="text-[10px]">Not marked</Badge>
                ) : mark.provenance === "teacher" ? (
                  <Badge variant="secondary" className="text-[10px]">Teacher</Badge>
                ) : null}
                {mark.marked && mark.provenance === "legacy" ? (
                  <Badge variant="outline" className="text-[10px]" title="Filled in automatically, not assessed. AI re-marking replaces it; marking it yourself makes it yours.">
                    Filled in
                  </Badge>
                ) : null}
                <span className="text-sm font-medium text-foreground">
                  {mark.awarded} / {mark.available}
                </span>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {Array.from({ length: mark.available + 1 }, (_, level) => {
                const isSelected = mark.marked && mark.awarded === level
                const descriptor = level === 0
                  ? "No descriptor met"
                  : mark.descriptors[level - 1] ?? `Level ${level}`
                return (
                  <button
                    key={level}
                    type="button"
                    disabled={isPending}
                    onClick={() => setAwarded(mark.success_criteria_id, level)}
                    title={mark.sc_type === "levelled" ? descriptor : undefined}
                    className={`rounded border px-2 py-0.5 text-xs transition disabled:opacity-50 ${
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {mark.sc_type === "binary" ? (level === 0 ? "No" : "Yes") : level}
                  </button>
                )
              })}
            </div>

            {mark.sc_type === "levelled" && mark.awarded > 0 && mark.descriptors[mark.awarded - 1] ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {mark.descriptors[mark.awarded - 1]}
              </p>
            ) : null}

            {/* The AI's comment, shown only while the teacher has not taken
                over this criterion. effectiveCriterionFeedback already
                suppresses it once the mark is overridden. */}
            {!mark.teacher_feedback && mark.feedback ? (
              <p className="mt-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                {mark.feedback}
              </p>
            ) : null}

            {aiMarked && mark.provenance === "teacher" && !mark.teacher_feedback ? (
              <p className="mt-2 text-xs italic text-muted-foreground">
                You changed this mark — the AI&apos;s comment no longer applies. Add your own below.
              </p>
            ) : null}

            <textarea
              value={drafts[mark.success_criteria_id] ?? mark.teacher_feedback ?? ""}
              disabled={isPending}
              placeholder={aiMarked ? "Your comment for this criterion (overrides the AI's)" : "Your comment for this criterion (optional)"}
              rows={2}
              onChange={(event) =>
                setDrafts((prev) => ({ ...prev, [mark.success_criteria_id]: event.target.value }))
              }
              onBlur={(event) => {
                const next = event.target.value.trim()
                if (next !== (mark.teacher_feedback ?? "")) {
                  saveFeedback(mark.success_criteria_id, next)
                }
              }}
              className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
