"use client"

import { Suspense, lazy, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LinkIcon, List, Target, Upload } from "lucide-react"
import { toast } from "sonner"

import type {
  AssessmentObjective,
  Curriculum,
  LearningObjectiveWithCriteria,
  LessonActivity,
  LessonSuccessCriterion,
  LessonWithObjectives,
  Unit,
} from "@/types"
import {
  LESSON_CHANNEL_NAME,
  LESSON_MUTATION_EVENT,
  LessonMutationEventSchema,
} from "@/lib/lesson-channel"
import { LessonDetailPayloadSchema } from "@/lib/lesson-snapshot-schema"
import { LessonFilesManager } from "@/components/lessons/lesson-files-manager"
import { LessonLinksManager } from "@/components/lessons/lesson-links-manager"
import { LessonActivitiesManager } from "@/components/lessons/lesson-activities-manager"
import { LessonObjectivesSidebar } from "@/components/lessons/lesson-objectives-sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const LessonHeaderSidebar = lazy(() =>
  import("@/components/lessons/lesson-header-sidebar").then((mod) => ({
    default: mod.LessonHeaderSidebar,
  })),
)

interface LessonPickerOption {
  lesson_id: string
  title: string
}

interface LessonDetailClientProps {
  lesson: LessonWithObjectives
  unit: Unit | null
  learningObjectives: LearningObjectiveWithCriteria[]
  curricula: Curriculum[]
  assessmentObjectives: AssessmentObjective[]
  lessonFiles: {
    name: string
    path: string
    created_at?: string | null
    updated_at?: string | null
    last_accessed_at?: string | null
    size?: number | null
  }[]
  lessonActivities: LessonActivity[]
  unitLessons: LessonPickerOption[]
}

export function LessonDetailClient({
  lesson,
  unit,
  learningObjectives,
  curricula,
  assessmentObjectives,
  lessonFiles,
  lessonActivities,
  unitLessons,
}: LessonDetailClientProps) {
  const router = useRouter()
  const [currentLesson, setCurrentLesson] = useState<LessonWithObjectives>(lesson)
  const [isHeaderSidebarOpen, setIsHeaderSidebarOpen] = useState(false)
  const [isObjectivesSidebarOpen, setIsObjectivesSidebarOpen] = useState(false)
  const [lessonFilesState, setLessonFilesState] = useState(lessonFiles)
  const [lessonActivitiesState, setLessonActivitiesState] = useState(lessonActivities)
  const [unitLessonsState, setUnitLessonsState] = useState(unitLessons)
  const [currentUnit, setCurrentUnit] = useState<Unit | null>(unit)

  useEffect(() => {
    setLessonFilesState(lessonFiles)
  }, [lessonFiles])

  useEffect(() => {
    setLessonActivitiesState(lessonActivities)
  }, [lessonActivities])

  useEffect(() => {
    setUnitLessonsState(unitLessons)
  }, [unitLessons])

  useEffect(() => {
    setCurrentLesson(lesson)
  }, [lesson])

  useEffect(() => {
    setCurrentUnit(unit)
  }, [unit])

  const isActive = currentLesson.active !== false

  useEffect(() => {
    const source = new EventSource("/sse?topics=lessons")

    source.onmessage = (event) => {
      const envelope = JSON.parse(event.data) as { topic?: string; type?: string; payload?: unknown }
      if (envelope.topic !== "lessons" || !envelope.payload) return
      const parsed = LessonMutationEventSchema.safeParse(envelope.payload)
      if (!parsed.success) return
      const payload = parsed.data
      if (payload.lesson_id !== lesson.lesson_id) return
      if (payload.status === "error") {
        toast.error(payload.message ?? "Lesson update failed")
        return
      }
      if (payload.status !== "completed") {
        return
      }
      const detail = LessonDetailPayloadSchema.safeParse(payload.data)
      if (!detail.success) {
        return
      }
      const snapshot = detail.data
      if (snapshot.lesson) {
        setCurrentLesson(snapshot.lesson)
      }
      if (snapshot.unit) {
        setCurrentUnit(snapshot.unit)
      }
      setLessonActivitiesState(snapshot.lessonActivities ?? [])
      setLessonFilesState(snapshot.lessonFiles ?? [])
      setUnitLessonsState(snapshot.unitLessons ?? [])
      if (payload.message) {
        toast.success(payload.message)
      }
    }

    return () => {
      source.close()
    }
  }, [lesson.lesson_id])

  const learningObjectivesById = useMemo(() => {
    const map = new Map<string, LearningObjectiveWithCriteria>()
    for (const objective of learningObjectives ?? []) {
      if (objective?.learning_objective_id) {
        map.set(objective.learning_objective_id, objective)
      }
    }
    return map
  }, [learningObjectives])

  const successCriteriaMetadata = useMemo(() => {
    const map = new Map<
      string,
      {
        objective: LearningObjectiveWithCriteria | null
        criterion: LearningObjectiveWithCriteria["success_criteria"][number]
      }
    >()

    for (const objective of learningObjectives ?? []) {
      for (const criterion of objective.success_criteria ?? []) {
        map.set(criterion.success_criteria_id, {
          objective,
          criterion,
        })
      }
    }

    return map
  }, [learningObjectives])

  const groupedLearningObjectives = useMemo(() => {
    const byObjective = new Map<string, LessonSuccessCriterion[]>()
    const unassigned: LessonSuccessCriterion[] = []

    for (const criterion of currentLesson.lesson_success_criteria ?? []) {
      const metadata = successCriteriaMetadata.get(criterion.success_criteria_id)
      const learningObjectiveId =
        criterion.learning_objective_id ??
        metadata?.criterion.learning_objective_id ??
        null

      if (learningObjectiveId) {
        const list = byObjective.get(learningObjectiveId) ?? []
        list.push(criterion)
        byObjective.set(learningObjectiveId, list)
      } else {
        unassigned.push(criterion)
      }
    }

    const displayGroups: Array<{
      key: string
      objective: LearningObjectiveWithCriteria | null
      criteria: Array<{
        id: string
        label: string
        level: number | null
        active: boolean
      }>
    }> = []

    for (const objective of learningObjectives ?? []) {
      const criteria = byObjective.get(objective.learning_objective_id)
      if (!criteria || criteria.length === 0) continue

      displayGroups.push({
        key: objective.learning_objective_id,
        objective,
        criteria: criteria.map((criterion) => {
          const metadata = successCriteriaMetadata.get(criterion.success_criteria_id)
          const description =
            metadata?.criterion.description?.trim() ??
            criterion.description?.trim() ??
            criterion.title ??
            "Success criterion"

          return {
            id: criterion.success_criteria_id,
            label: description,
            level: metadata?.criterion.level ?? criterion.level ?? null,
            active: metadata?.criterion.active ?? true,
          }
        }),
      })
    }

    if (unassigned.length > 0) {
      displayGroups.push({
        key: "unassigned",
        objective: null,
        criteria: unassigned.map((criterion) => {
          const metadata = successCriteriaMetadata.get(criterion.success_criteria_id)
          const description =
            metadata?.criterion.description?.trim() ??
            criterion.description?.trim() ??
            criterion.title ??
            "Success criterion"

          return {
            id: criterion.success_criteria_id,
            label: description,
            level: metadata?.criterion.level ?? criterion.level ?? null,
            active: metadata?.criterion.active ?? true,
          }
        }),
      })
    }

    return displayGroups
  }, [currentLesson.lesson_success_criteria, learningObjectives, successCriteriaMetadata])

  const lessonSuccessCriteria = useMemo(() => {
    return (currentLesson.lesson_success_criteria ?? []).map((criterion) => {
      const metadata = successCriteriaMetadata.get(criterion.success_criteria_id)
      const learningObjective =
        metadata?.objective ??
        (criterion.learning_objective_id
          ? learningObjectivesById.get(criterion.learning_objective_id)
          : null)

      const description =
        metadata?.criterion.description?.trim() ??
        criterion.description?.trim() ??
        criterion.title ??
        "Success criterion"

      return {
        successCriteriaId: criterion.success_criteria_id,
        title: description,
        learningObjectiveId:
          metadata?.criterion.learning_objective_id ?? criterion.learning_objective_id ?? null,
        learningObjectiveTitle: learningObjective?.title ?? null,
      }
    })
  }, [currentLesson.lesson_success_criteria, learningObjectivesById, successCriteriaMetadata])

  const handleLessonUpdated = (updated: LessonWithObjectives) => {
    setCurrentLesson(updated)
    router.refresh()
  }

  const handleLessonSelect = (value: string) => {
    if (value && value !== currentLesson.lesson_id) {
      router.push(`/lessons/${value}`)
    }
  }

  return (
    <>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs uppercase tracking-wide text-slate-300">Unit</span>
                <Link
                  href={
                    currentUnit ? `/units/${currentUnit.unit_id}` : `/units/${currentLesson.unit_id}`
                  }
                  className="text-xl font-semibold text-white underline-offset-4 transition hover:text-slate-200 hover:underline"
                >
                  {currentUnit?.title ?? currentLesson.unit_id}
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge
                  variant="outline"
                  className={
                    isActive
                      ? "bg-emerald-200/20 text-emerald-100"
                      : "bg-rose-200/20 text-rose-100"
                  }
                >
                  {isActive ? "Active" : "Inactive"}
                </Badge>
                {unitLessonsState.length > 0 ? (
                  <Select value={currentLesson.lesson_id} onValueChange={handleLessonSelect}>
                    <SelectTrigger className="w-60 border-white/30 bg-white/10 text-left text-sm text-white hover:bg-white/15 focus:ring-0 focus:ring-offset-0">
                      <SelectValue placeholder="Select lesson" />
                    </SelectTrigger>
                    <SelectContent>
                      {unitLessonsState.map((option) => (
                        <SelectItem key={option.lesson_id} value={option.lesson_id}>
                          {option.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-3xl font-semibold text-white">{currentLesson.title}</h1>
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-white/10 text-white hover:bg-white/20"
                  onClick={() => setIsHeaderSidebarOpen(true)}
                >
                  Edit lesson details
                </Button>
              </div>
            </div>
          </div>
        </header>

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-xl font-semibold">
              <Target className="h-5 w-5 text-primary" />
              Learning Objectives
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setIsObjectivesSidebarOpen(true)}>
              Edit Objectives
            </Button>
          </CardHeader>
          <CardContent>
            {groupedLearningObjectives.length > 0 ? (
              <ul className="space-y-4">
                {groupedLearningObjectives.map((group) => (
                  <li key={group.key} className="space-y-3 rounded-md border border-border p-4">
                    <div className="font-medium">
                      {group.objective?.title ?? "Unassigned success criteria"}
                    </div>
                    <ul className="space-y-2 list-disc pl-6 text-sm text-muted-foreground">
                      {group.criteria.map((criterion) => (
                        <li key={criterion.id}>
                          {criterion.level ? (
                            <span className="font-semibold text-primary">
                              Level {criterion.level}:
                            </span>
                          ) : (
                            <span className="font-semibold text-primary">Success criterion:</span>
                          )}{" "}
                          <span className="text-foreground">{criterion.label}</span>
                          {!criterion.active ? (
                            <Badge variant="destructive" className="ml-2 text-xs">
                              Inactive
                            </Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No success criteria are linked to this lesson yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-xl font-semibold">
              <List className="h-5 w-5 text-primary" />
              Lesson Activities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LessonActivitiesManager
              unitId={currentUnit?.unit_id ?? currentLesson.unit_id}
              lessonId={currentLesson.lesson_id}
              initialActivities={lessonActivitiesState}
              availableSuccessCriteria={lessonSuccessCriteria}
            />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <LinkIcon className="h-5 w-5 text-primary" />
                Lesson Links
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LessonLinksManager
                unitId={currentUnit?.unit_id ?? currentLesson.unit_id}
                lessonId={currentLesson.lesson_id}
                initialLinks={currentLesson.lesson_links ?? []}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <Upload className="h-5 w-5 text-primary" />
                Lesson Files
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LessonFilesManager
                unitId={currentUnit?.unit_id ?? currentLesson.unit_id}
                lessonId={currentLesson.lesson_id}
                initialFiles={lessonFilesState}
              />
            </CardContent>
          </Card>
        </div>
      </main>

      <Suspense fallback={null}>
        {isHeaderSidebarOpen ? (
          <LessonHeaderSidebar
            lesson={currentLesson}
            isOpen={isHeaderSidebarOpen}
            onClose={() => setIsHeaderSidebarOpen(false)}
            onUpdated={handleLessonUpdated}
          />
        ) : null}
      </Suspense>

      <LessonObjectivesSidebar
        unitId={currentUnit?.unit_id ?? currentLesson.unit_id}
        lesson={currentLesson}
        learningObjectives={learningObjectives}
        curricula={curricula}
        assessmentObjectives={assessmentObjectives}
        selectedSuccessCriteria={currentLesson.lesson_success_criteria ?? []}
        isOpen={isObjectivesSidebarOpen}
        onClose={() => setIsObjectivesSidebarOpen(false)}
        onUpdate={handleLessonUpdated}
      />
    </>
  )
}
