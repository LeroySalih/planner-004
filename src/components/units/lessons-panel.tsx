"use client"

import { useState, useTransition } from "react"
import { BookOpen, GripVertical, Plus } from "lucide-react"

import type { LessonWithObjectives, LearningObjectiveWithCriteria } from "@/lib/server-updates"
import { reorderLessonsAction } from "@/lib/server-updates"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LessonSidebar } from "@/components/units/lesson-sidebar"
import { toast } from "sonner"

interface LessonsPanelProps {
  unitId: string
  initialLessons: LessonWithObjectives[]
  learningObjectives: LearningObjectiveWithCriteria[]
}

export function LessonsPanel({ unitId, initialLessons, learningObjectives }: LessonsPanelProps) {
  const [lessons, setLessons] = useState(() =>
    [...initialLessons].sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0)),
  )
  const [selectedLesson, setSelectedLesson] = useState<LessonWithObjectives | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [draggingLessonId, setDraggingLessonId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [, startTransition] = useTransition()

  const openCreateSidebar = () => {
    setSelectedLesson(null)
    setIsSidebarOpen(true)
  }

  const handleLessonClick = (lesson: LessonWithObjectives) => {
    if (isDragging) return
    setSelectedLesson(lesson)
    setIsSidebarOpen(true)
  }

  const upsertLesson = (lesson: LessonWithObjectives) => {
    setLessons((prev) => {
      const existingIndex = prev.findIndex((item) => item.lesson_id === lesson.lesson_id)
      if (existingIndex !== -1) {
        const next = [...prev]
        next[existingIndex] = lesson
        return next.sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
      }
      return [...prev, lesson].sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
    })
  }

  const deactivateLesson = (lessonId: string) => {
    setLessons((prev) =>
      prev
        .map((lesson) =>
          lesson.lesson_id === lessonId ? { ...lesson, active: false } : lesson,
        )
        .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0)),
    )
  }

  const activeLessons = lessons.filter((lesson) => lesson.active !== false)

  const handleDragStart = (lessonId: string, event: React.DragEvent) => {
    setDraggingLessonId(lessonId)
    setIsDragging(true)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", lessonId)
  }

  const handleDragEnd = () => {
    setDraggingLessonId(null)
    setIsDragging(false)
  }

  const handleDrop = (targetLessonId: string | null) => (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!draggingLessonId || draggingLessonId === targetLessonId) {
      handleDragEnd()
      return
    }

    const result = reorderActiveLessonList(lessons, draggingLessonId, targetLessonId)
    if (!result) {
      handleDragEnd()
      return
    }

    const { updatedLessons, payload } = result
    const previousLessons = lessons

    setLessons(updatedLessons)
    handleDragEnd()

    startTransition(async () => {
      const response = await reorderLessonsAction(unitId, payload)
      if (!response.success) {
        toast.error("Failed to update lesson order", {
          description: response.error ?? "Please try again shortly.",
        })
        setLessons(previousLessons)
      }
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-xl font-semibold">
            <BookOpen className="h-5 w-5 text-primary" />
            Lessons
          </CardTitle>
          <CardDescription>Only active lessons appear in this list.</CardDescription>
        </div>
        <Button size="sm" onClick={openCreateSidebar}>
          <Plus className="mr-2 h-4 w-4" />
          Add Lesson
        </Button>
      </CardHeader>
      <CardContent onDragOver={(event) => event.preventDefault()} onDrop={handleDrop(null)}>
        {activeLessons.length > 0 ? (
          <div className="space-y-3">
            {activeLessons.map((lesson) => (
              <button
                key={lesson.lesson_id}
                type="button"
                draggable
                onClick={() => handleLessonClick(lesson)}
                onDragStart={(event) => handleDragStart(lesson.lesson_id, event)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop(lesson.lesson_id)}
                onDragEnd={handleDragEnd}
                className={cn(
                  "w-full rounded-lg border border-border p-4 text-left transition hover:border-primary cursor-grab active:cursor-grabbing",
                  draggingLessonId === lesson.lesson_id && "opacity-60",
                )}
                aria-grabbed={draggingLessonId === lesson.lesson_id}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span className="font-medium">{lesson.title}</span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {lesson.active === false ? "Inactive" : "Active"}
                  </Badge>
                </div>
                {lesson.lesson_objectives && lesson.lesson_objectives.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {lesson.lesson_objectives.map((objective) => (
                      <li key={objective.learning_objective_id}>
                        {objective.learning_objective?.title ?? objective.title}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Drag the handle to reorder or click to edit this lesson.
                  </p>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No active lessons yet. Click “Add Lesson” to create the first one.
          </div>
        )}
      </CardContent>

      <LessonSidebar
        unitId={unitId}
        lesson={selectedLesson}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onCreateOrUpdate={upsertLesson}
        onDeactivate={deactivateLesson}
        learningObjectives={learningObjectives}
      />
    </Card>
  )
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = [...array]
  if (from < 0 || from >= result.length) return result
  const [item] = result.splice(from, 1)
  let target = to
  if (target < 0) target = 0
  if (target > result.length) target = result.length
  result.splice(target, 0, item)
  return result
}

function reorderActiveLessonList(
  lessons: LessonWithObjectives[],
  draggedLessonId: string,
  targetLessonId: string | null,
):
  | {
      updatedLessons: LessonWithObjectives[]
      payload: { lessonId: string; orderBy: number }[]
    }
  | null {
  const activeLessons = lessons
    .filter((lesson) => lesson.active !== false)
    .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))

  const fromIndex = activeLessons.findIndex((lesson) => lesson.lesson_id === draggedLessonId)
  if (fromIndex === -1) {
    return null
  }

  let toIndex = targetLessonId
    ? activeLessons.findIndex((lesson) => lesson.lesson_id === targetLessonId)
    : activeLessons.length - 1

  if (toIndex === -1) {
    toIndex = activeLessons.length - 1
  }

  if (fromIndex === toIndex) {
    return null
  }

  const reorderedActive = arrayMove(activeLessons, fromIndex, toIndex).map((lesson, index) => ({
    ...lesson,
    order_by: index,
  }))

  const reorderedMap = new Map(reorderedActive.map((lesson) => [lesson.lesson_id, lesson]))

  const updatedLessons = lessons
    .map((lesson) => reorderedMap.get(lesson.lesson_id) ?? lesson)
    .sort((a, b) => {
      const aInactive = a.active === false ? 1 : 0
      const bInactive = b.active === false ? 1 : 0
      if (aInactive !== bInactive) return aInactive - bInactive
      return (a.order_by ?? 0) - (b.order_by ?? 0)
    })

  const payload = reorderedActive.map((lesson) => ({
    lessonId: lesson.lesson_id,
    orderBy: lesson.order_by,
  }))

  return { updatedLessons, payload }
}
