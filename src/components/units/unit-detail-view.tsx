"use client"

import { useEffect, useMemo, useState } from "react"
import { Calendar, Edit2, Target, Users } from "lucide-react"

import type { Assignment, Group, Groups, Subjects, Unit } from "@/types"
import type {
  LearningObjectiveWithCriteria,
  LessonWithObjectives,
} from "@/lib/server-updates"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LessonsPanel } from "@/components/units/lessons-panel"
import { UnitEditSidebar } from "@/components/units/unit-edit-sidebar"
import { UnitFilesPanel } from "@/components/units/unit-files-panel"

const levelStyleMap: Record<number, string> = {
  1: "bg-emerald-100 text-emerald-900",
  2: "bg-emerald-200 text-emerald-900",
  3: "bg-emerald-300 text-emerald-900",
  4: "bg-emerald-400 text-emerald-900",
  5: "bg-emerald-500 text-emerald-50",
  6: "bg-emerald-600 text-emerald-50",
  7: "bg-emerald-700 text-emerald-50",
}

interface UnitDetailViewProps {
  unit: Unit
  assignments: Assignment[]
  groups: Groups
  subjects: Subjects
  learningObjectives: LearningObjectiveWithCriteria[]
  lessons: LessonWithObjectives[]
  unitFiles: { name: string; path: string; created_at?: string; updated_at?: string; size?: number }[]
}

export function UnitDetailView({
  unit,
  assignments,
  groups,
  subjects,
  learningObjectives,
  lessons,
  unitFiles,
}: UnitDetailViewProps) {
  const [isUnitSidebarOpen, setIsUnitSidebarOpen] = useState(false)
  const [currentUnit, setCurrentUnit] = useState<Unit>(unit)

  useEffect(() => {
    setCurrentUnit(unit)
  }, [unit])

  const groupsById = useMemo(() => {
    const map = new Map<string, Group>()
    groups.forEach((group) => {
      map.set(group.group_id, group)
    })
    return map
  }, [groups])

  const isActive = currentUnit.active ?? true
  const statusClassName = isActive
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : "bg-rose-100 text-rose-700 border-rose-200"

  const orderedObjectives = useMemo(
    () => sortObjectives(learningObjectives),
    [learningObjectives],
  )

  const groupedAssessmentObjectives = useMemo(() => {
    type ObjectiveCriterion = {
      success_criteria_id: string
      learning_objective_id: string
      description: string
      level: number
      active: boolean
      order_index: number
      units: string[]
    }

    const map = new Map<
      string,
      {
        id: string
        code: string
        title: string
        orderIndex: number
        objectives: Array<{
          id: string
          title: string
          successCriteria: ObjectiveCriterion[]
        }>
      }
    >()

    lessons.forEach((lesson) => {
      const lessonObjectives = lesson.lesson_objectives ?? []
      const lessonCriteria = lesson.lesson_success_criteria ?? []

      lessonObjectives.forEach((objective) => {
        const learningObjectiveId =
          objective.learning_objective_id ?? objective.learning_objective?.learning_objective_id
        if (!learningObjectiveId) {
          return
        }

        const learningObjective = objective.learning_objective
        const assessmentObjectiveId = learningObjective?.assessment_objective_id ?? "unassigned"
        const assessmentObjectiveCode = learningObjective?.assessment_objective_code ?? "Unassigned"
        const assessmentObjectiveTitle =
          learningObjective?.assessment_objective_title ?? "Unassigned Assessment Objective"
        const assessmentObjectiveOrder =
          learningObjective?.assessment_objective_order_index ?? Number.MAX_SAFE_INTEGER

        if (!map.has(assessmentObjectiveId)) {
          map.set(assessmentObjectiveId, {
            id: assessmentObjectiveId,
            code: assessmentObjectiveCode,
            title: assessmentObjectiveTitle,
            orderIndex: assessmentObjectiveOrder,
            objectives: [],
          })
        }

        const group = map.get(assessmentObjectiveId)
        if (!group) return
        group.orderIndex = Math.min(group.orderIndex, assessmentObjectiveOrder)

        let objectiveEntry = group.objectives.find((entry) => entry.id === learningObjectiveId)

        if (!objectiveEntry) {
          objectiveEntry = {
            id: learningObjectiveId,
            title: learningObjective?.title ?? objective.title ?? "Learning objective",
            successCriteria: [] as ObjectiveCriterion[],
          }
          group.objectives.push(objectiveEntry)
        }

        const existingIds = new Set(objectiveEntry.successCriteria.map((item) => item.success_criteria_id))

        lessonCriteria
          .filter((criterion) => criterion.learning_objective_id === learningObjectiveId)
          .forEach((criterion) => {
            if (existingIds.has(criterion.success_criteria_id)) {
              return
            }

            const description =
              typeof criterion.description === "string" && criterion.description.trim().length > 0
                ? criterion.description.trim()
                : criterion.title

            objectiveEntry.successCriteria.push({
              success_criteria_id: criterion.success_criteria_id,
              learning_objective_id: learningObjectiveId,
              description,
              level: typeof criterion.level === "number" ? Math.max(1, Math.min(criterion.level, 7)) : 1,
              active: true,
              order_index: 0,
              units: [],
            })
            existingIds.add(criterion.success_criteria_id)
          })

        const sortedCriteria = objectiveEntry.successCriteria.sort((a, b) => {
          if (a.level !== b.level) {
            return a.level - b.level
          }
          return a.description.localeCompare(b.description)
        })

        objectiveEntry.successCriteria = sortedCriteria.map((criterion, index) => ({
          ...criterion,
          order_index: index,
        }))
      })
    })

    return Array.from(map.values())
      .map((group) => ({
        ...group,
        objectives: group.objectives
          .filter((objective) => objective.successCriteria.length > 0)
          .sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .filter((group) => group.objectives.length > 0)
      .sort((a, b) => {
        if (a.orderIndex !== b.orderIndex) {
          return a.orderIndex - b.orderIndex
        }
        return a.title.localeCompare(b.title)
      })
  }, [lessons])

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-balance">{currentUnit.title}</h1>
              <Badge variant="outline" className={statusClassName}>
                {isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
              <Badge variant="outline">Subject: {currentUnit.subject}</Badge>
              {currentUnit.year ? <Badge variant="secondary">Year {currentUnit.year}</Badge> : null}
              <span className="text-sm">Unit ID: {currentUnit.unit_id}</span>
            </div>
          </div>
          <Button onClick={() => setIsUnitSidebarOpen(true)} className="self-start">
            <Edit2 className="mr-2 h-4 w-4" />
            Edit Unit
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Description</CardTitle>
          </CardHeader>
          <CardContent>
            {currentUnit.description ? (
              <p className="leading-relaxed text-muted-foreground whitespace-pre-line">{currentUnit.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No description has been provided for this unit yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl font-semibold">
              <Target className="h-5 w-5 text-primary" />
              Curriculum Alignment
            </CardTitle>
            <CardDescription>
              Assessment objectives, learning objectives, and success criteria defined on the curriculum page.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {groupedAssessmentObjectives.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="w-48 px-4 py-3">Assessment Objective</th>
                    <th className="w-72 px-4 py-3">Learning Objective</th>
                    <th className="px-4 py-3">Success Criteria</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedAssessmentObjectives.map((group) => {
                    const rowSpan = group.objectives.reduce(
                      (count, objective) => count + Math.max(objective.successCriteria.length, 1),
                      0,
                    )

                    let aoCellRendered = false

                    return group.objectives.map((objective) => {
                      const criteria = objective.successCriteria.length > 0
                        ? objective.successCriteria
                        : [null]

                      return criteria.map((criterion, index) => {
                        const isFirstCriterionForObjective = index === 0
                        const objectiveRowSpan = objective.successCriteria.length || 1

                        const aoCell = !aoCellRendered ? (
                          <td
                            className="border-b border-border px-4 py-3 align-top text-sm font-medium"
                            rowSpan={rowSpan}
                          >
                            <div className="flex flex-col gap-1">
                              <span className="text-primary">{group.code}</span>
                              <span className="text-muted-foreground">{group.title}</span>
                            </div>
                          </td>
                        ) : null

                        if (!aoCellRendered) {
                          aoCellRendered = true
                        }

                        return (
                          <tr key={`${group.id}-${objective.id}-${criterion?.success_criteria_id ?? index}`} className="border-b border-border">
                            {aoCell}
                            {isFirstCriterionForObjective ? (
                              <td
                                className="border-b border-border px-4 py-3 align-top text-sm font-medium"
                                rowSpan={objectiveRowSpan}
                              >
                                <span className="text-foreground">{objective.title}</span>
                              </td>
                            ) : null}
                            <td className="border-b border-border px-4 py-3 align-top">
                              {criterion ? (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant="secondary"
                                      className={`border-none text-xs font-semibold text-foreground ${levelStyleMap[Math.min(Math.max(criterion.level, 1), 7)]}`}
                                    >
                                      Level {criterion.level}
                                    </Badge>
                                    {criterion.active === false && (
                                      <Badge variant="destructive" className="text-xs">
                                        Inactive
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-sm text-foreground">{criterion.description}</p>
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  No success criteria defined for this objective.
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    })
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No curriculum-aligned learning objectives are assigned to this unit yet.
            </div>
          )}
        </CardContent>
      </Card>

      <LessonsPanel
        unitId={currentUnit.unit_id}
        unitTitle={currentUnit.title}
        initialLessons={lessons}
        learningObjectives={orderedObjectives}
      />

      <UnitFilesPanel unitId={currentUnit.unit_id} initialFiles={unitFiles} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-semibold">
            <Users className="h-5 w-5 text-primary" />
            Related Assignments
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {assignments.length > 0 ? (
            assignments.map((assignment) => {
              const group = groupsById.get(assignment.group_id)
              return (
                <div
                  key={`${assignment.group_id}-${assignment.unit_id}-${assignment.start_date}`}
                  className="flex flex-col gap-1 rounded-lg border border-border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      Group: {assignment.group_id}
                      {group?.subject && (
                        <span className="ml-2 text-muted-foreground">({group.subject})</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {formatDate(assignment.start_date)} – {formatDate(assignment.end_date)}
                      </span>
                      {group?.join_code && (
                        <Badge variant="outline">Join Code: {group.join_code}</Badge>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6 text-muted-foreground">
              <p className="font-medium">No assignments are linked to this unit yet.</p>
              <p className="text-sm">Return to the assignments dashboard to schedule this unit with a group.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <UnitEditSidebar
        unit={currentUnit}
        subjects={subjects}
        isOpen={isUnitSidebarOpen}
        onClose={() => setIsUnitSidebarOpen(false)}
        onOptimisticUpdate={setCurrentUnit}
      />
    </>
  )
}

function sortObjectives(objectives: LearningObjectiveWithCriteria[]) {
  return [...objectives].sort((a, b) => {
    const aOrder = a.order_index ?? Number.MAX_SAFE_INTEGER
    const bOrder = b.order_index ?? Number.MAX_SAFE_INTEGER
    if (aOrder !== bOrder) {
      return aOrder - bOrder
    }
    return a.title.localeCompare(b.title)
  })
}
