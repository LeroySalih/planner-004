"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { FeedbackCell, type BulkFeedbackAction } from "../../../../_components/feedback-cell"

type PupilRow = {
  userId: string
  displayName: string
}

type SuccessCriterionColumn = {
  id: string
  description: string
  level: number
  learningObjectiveTitle: string | null
}

type LessonFeedbackTableProps = {
  lessonId: string
  pupils: PupilRow[]
  successCriteria: SuccessCriterionColumn[]
  initialRatings: Record<string, 1 | -1 | null>
  objectivesCount: number
}

export function LessonFeedbackTable({
  lessonId,
  pupils,
  successCriteria,
  initialRatings,
  objectivesCount,
}: LessonFeedbackTableProps) {
  const [bulkAction, setBulkAction] = useState<BulkFeedbackAction | null>(null)

  const handleBulkApply = (type: BulkFeedbackAction["type"]) => {
    setBulkAction({ type, timestamp: Date.now() })
  }

  const hasPupils = pupils.length > 0
  const hasCriteria = successCriteria.length > 0
  const disableBulk = !hasPupils || !hasCriteria

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm text-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Learning Objectives & Success Criteria</h2>
          <span className="text-sm text-slate-600">{objectivesCount} learning objectives</span>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleBulkApply("up")}
            disabled={disableBulk}
            className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          >
            Mark all green
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleBulkApply("down")}
            disabled={disableBulk}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            Mark all red
          </Button>
        </div>
      </div>

      {objectivesCount === 0 ? (
        <p className="mt-4 text-sm text-slate-600">
          No learning objectives linked to this lesson yet.
        </p>
      ) : !hasCriteria ? (
        <p className="mt-4 text-sm text-slate-600">
          No success criteria are assigned to this group for the current units.
        </p>
      ) : (
        <div className="mt-6 max-h-[60vh] overflow-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border border-border bg-muted px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-slate-600 shadow-sm">
                  Pupil
                </th>
                {successCriteria.map((criterion) => (
                  <th
                    key={criterion.id}
                    className="sticky top-0 z-10 border border-border bg-muted px-4 py-3 text-left align-top shadow-sm"
                  >
                    <span className="block text-[11px] font-medium text-slate-500">
                      {criterion.learningObjectiveTitle ?? "Learning objective"}
                    </span>
                    <span className="mt-1 block text-sm font-semibold text-slate-900">{criterion.description}</span>
                    <span className="mt-1 block text-xs text-slate-500">Level {criterion.level}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!hasPupils ? (
                <tr>
                  <td
                    colSpan={successCriteria.length + 1}
                    className="border border-border px-4 py-6 text-center text-sm text-slate-600"
                  >
                    No pupils assigned to this group yet.
                  </td>
                </tr>
              ) : (
                pupils.map((pupil) => (
                  <tr key={pupil.userId}>
                    <td className="sticky left-0 z-10 border border-border bg-background px-4 py-3 align-top shadow-sm">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-900">{pupil.displayName}</span>
                      </div>
                    </td>
                    {successCriteria.map((criterion) => {
                      const ratingKey = `${pupil.userId}-${criterion.id}`
                      const initialRating = initialRatings[ratingKey] ?? null

                      return (
                        <FeedbackCell
                          key={ratingKey}
                          pupilId={pupil.userId}
                          pupilName={pupil.displayName}
                          criterionId={criterion.id}
                          criterionDescription={criterion.description}
                          lessonId={lessonId}
                          initialRating={initialRating}
                          bulkAction={bulkAction}
                        />
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

