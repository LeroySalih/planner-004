"use client"

import { useEffect, useMemo, useState } from "react"
import { Calendar, Edit2, Plus, Target, Users } from "lucide-react"

import type { Assignment, Group, Groups, Subjects, Unit } from "@/types"
import type {
  LearningObjectiveWithCriteria,
  LessonWithObjectives,
} from "@/lib/server-updates"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UnitEditSidebar } from "@/components/units/unit-edit-sidebar"
import { LearningObjectiveSidebar } from "@/components/units/learning-objective-sidebar"
import { LessonsPanel } from "@/components/units/lessons-panel"
import { UnitFilesPanel } from "@/components/units/unit-files-panel"

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
  const [objectives, setObjectives] = useState<LearningObjectiveWithCriteria[]>(learningObjectives)
  const [selectedObjective, setSelectedObjective] = useState<LearningObjectiveWithCriteria | null>(null)
  const [isObjectiveSidebarOpen, setIsObjectiveSidebarOpen] = useState(false)

  useEffect(() => {
    setCurrentUnit(unit)
  }, [unit])

  useEffect(() => {
    setObjectives(learningObjectives)
  }, [learningObjectives])

  const groupsById = useMemo(() => {
    const map = new Map<string, Group>()
    groups.forEach((group) => {
      map.set(group.group_id, group)
    })
    return map
  }, [groups])

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })

  const isActive = currentUnit.active ?? true
  const statusClassName = isActive
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : "bg-rose-100 text-rose-700 border-rose-200"

  const objectiveLessonCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    lessons
      .filter((lesson) => lesson.active !== false)
      .forEach((lesson) => {
        const seen = new Set<string>()
        lesson.lesson_objectives?.forEach((objective) => {
          if (!objective?.learning_objective_id || seen.has(objective.learning_objective_id)) return
          counts[objective.learning_objective_id] = (counts[objective.learning_objective_id] ?? 0) + 1
          seen.add(objective.learning_objective_id)
        })
      })
    return counts
  }, [lessons])

  const openCreateObjective = () => {
    setSelectedObjective(null)
    setIsObjectiveSidebarOpen(true)
  }

  const openEditObjective = (objective: LearningObjectiveWithCriteria) => {
    setSelectedObjective(objective)
    setIsObjectiveSidebarOpen(true)
  }

  const handleObjectiveSaved = (objective: LearningObjectiveWithCriteria) => {
    setObjectives((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.learning_objective_id === objective.learning_objective_id,
      )
      if (existingIndex !== -1) {
        const next = [...prev]
        next[existingIndex] = objective
        return next
      }
      return [...prev, objective].sort((a, b) => a.title.localeCompare(b.title))
    })
    setSelectedObjective(objective)
  }

  const handleObjectiveDeleted = (learningObjectiveId: string) => {
    setObjectives((prev) => prev.filter((item) => item.learning_objective_id !== learningObjectiveId))
    setSelectedObjective(null)
  }

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
              Learning Objectives
            </CardTitle>
            <CardDescription>Each objective can include up to three success criteria.</CardDescription>
          </div>
          <Button size="sm" onClick={openCreateObjective}>
            <Plus className="mr-2 h-4 w-4" />
            Add Objective
          </Button>
        </CardHeader>
        <CardContent>
          {objectives.length > 0 ? (
            <div className="space-y-3">
              {objectives.map((objective) => {
                const lessonCount = objectiveLessonCounts[objective.learning_objective_id] ?? 0
                const label = lessonCount === 1 ? "lesson" : "lessons"

                return (
                  <button
                    key={objective.learning_objective_id}
                    type="button"
                    onClick={() => openEditObjective(objective)}
                    className="w-full rounded-lg border border-border p-4 text-left transition hover:border-primary"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{objective.title}</span>
                      <span className="text-sm text-muted-foreground">
                        {lessonCount} {label}
                      </span>
                    </div>
                    {lessonCount === 0 && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        This objective is not linked to any lessons yet.
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No learning objectives yet. Click “Add Objective” to create the first one.
            </div>
          )}
        </CardContent>
      </Card>

      <LessonsPanel
        unitId={currentUnit.unit_id}
        initialLessons={lessons}
        learningObjectives={objectives}
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

      <LearningObjectiveSidebar
        unitId={currentUnit.unit_id}
        learningObjective={selectedObjective}
        isOpen={isObjectiveSidebarOpen}
        onClose={() => setIsObjectiveSidebarOpen(false)}
        onCreateOrUpdate={handleObjectiveSaved}
        onDelete={handleObjectiveDeleted}
      />
    </>
  )
}
