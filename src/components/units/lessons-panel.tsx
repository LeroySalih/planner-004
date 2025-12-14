"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { BookOpen, GripVertical, Plus } from "lucide-react"

import type { LessonWithObjectives, LearningObjectiveWithCriteria } from "@/lib/server-updates"
import { LessonJobPayloadSchema } from "@/types"
import { reorderLessonsAction } from "@/lib/server-actions/lessons"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LessonSidebar } from "@/components/units/lesson-sidebar"
import { toast } from "sonner"

interface LessonsPanelProps {
  unitId: string
  unitTitle: string
  initialLessons: LessonWithObjectives[]
  learningObjectives: LearningObjectiveWithCriteria[]
}

const LESSON_CHANNEL_NAME = "lesson_updates"
const LESSON_CREATED_EVENT = "lesson:created"
const LESSON_SSE_URL = "/sse?topics=lessons"

export function LessonsPanel({ unitId, unitTitle, initialLessons, learningObjectives }: LessonsPanelProps) {
  const [lessons, setLessons] = useState(() =>
    [...initialLessons].sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0)),
  )
  const pendingLessonJobsRef = useRef(new Map<string, { title: string }>())
  const [pendingLessonIds, setPendingLessonIds] = useState<Record<string, boolean>>({})
  const [selectedLesson, setSelectedLesson] = useState<LessonWithObjectives | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [draggingLessonId, setDraggingLessonId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [, startTransition] = useTransition()
  const pageLoadTimeRef = useRef<number>(Date.now())

  const openCreateSidebar = () => {
    setSelectedLesson(null)
    setIsSidebarOpen(true)
  }

  const upsertLesson = useCallback((lesson: LessonWithObjectives) => {
    setLessons((prev) => {
      const existingIndex = prev.findIndex((item) => item.lesson_id === lesson.lesson_id)
      if (existingIndex !== -1) {
        const next = [...prev]
        next[existingIndex] = lesson
        return next.sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
      }
      return [...prev, lesson].sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
    })
  }, [])

  const deactivateLesson = useCallback((lessonId: string) => {
    setLessons((prev) =>
      prev
        .map((lesson) => (lesson.lesson_id === lessonId ? { ...lesson, active: false } : lesson))
        .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0)),
    )
  }, [])

  const handleLessonJobQueued = useCallback(
    (jobId: string, title: string) => {
      if (pendingLessonJobsRef.current.has(jobId)) {
        return
      }

      const normalizedTitle = title.trim().length > 0 ? title.trim() : "New lesson"
      pendingLessonJobsRef.current.set(jobId, { title: normalizedTitle })

      setLessons((prev) => {
        const maxOrder = prev.reduce((max, lesson) => {
          const value = lesson.order_by ?? 0
          return value > max ? value : max
        }, 0)

        const placeholder: LessonWithObjectives = {
          lesson_id: jobId,
          unit_id: unitId,
          title: normalizedTitle,
          order_by: maxOrder + 0.5,
          active: true,
          lesson_objectives: [],
          lesson_links: [],
          lesson_success_criteria: [],
        }

        return [...prev, placeholder].sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
      })

      setPendingLessonIds((prev) => ({ ...prev, [jobId]: true }))
    },
    [unitId],
  )

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

  useEffect(() => {
    pageLoadTimeRef.current = Date.now()
    const source = new EventSource(LESSON_SSE_URL)

    source.onmessage = (event) => {
      const envelope = JSON.parse(event.data) as { topic?: string; type?: string; payload?: unknown; createdAt?: string }
      if (envelope.topic !== "lessons" || !envelope.payload) return
      const createdAtMs = envelope.createdAt ? new Date(envelope.createdAt).getTime() : Date.now()
      if (createdAtMs < pageLoadTimeRef.current) {
        return
      }
      const parsed = LessonJobPayloadSchema.safeParse(envelope.payload)
      if (!parsed.success) {
        console.warn("[lessons] received invalid lesson job payload", parsed.error)
        return
      }

      const payload = parsed.data
      if (payload.unit_id !== unitId) {
        return
      }

      const jobId = payload.job_id

      setLessons((prev) => prev.filter((lesson) => lesson.lesson_id !== jobId))
      setPendingLessonIds((prev) => {
        const { [jobId]: _removed, ...rest } = prev
        return rest
      })
      pendingLessonJobsRef.current.delete(jobId)

      if (payload.status === "completed") {
        if (payload.lesson) {
          upsertLesson(payload.lesson)
        }
        const description = `event=${payload.operation ?? envelope.type ?? "unknown"} · status=${payload.status} · job=${payload.job_id ?? "n/a"}`
        console.debug("[lessons:sse] toast trigger", {
          unitId,
          lessonId: payload.lesson_id ?? null,
          status: payload.status,
          message: payload.message,
          eventType: payload.operation ?? envelope.type ?? null,
          jobId: payload.job_id ?? null,
          payload: envelope.payload,
          createdAt: envelope.createdAt ?? null,
        })
        toast.success(payload.message ?? "Lesson created successfully.", { description })
      } else if (payload.status === "error") {
        toast.error(payload.message ?? "Failed to create lesson.")
      }
    }

    source.onerror = () => {
      // rely on browser retry
    }

    return () => {
      pendingLessonJobsRef.current.clear()
      source.close()
    }
  }, [unitId, upsertLesson])

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
            {activeLessons.map((lesson) => {
              const isPendingLesson = pendingLessonIds[lesson.lesson_id] === true

              return (
                <div
                  key={lesson.lesson_id}
                  draggable={!isPendingLesson}
                  onDragStart={(event) => handleDragStart(lesson.lesson_id, event)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop(lesson.lesson_id)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "w-full rounded-lg border border-border p-4 text-left transition hover:border-primary",
                    draggingLessonId === lesson.lesson_id && "opacity-60",
                  )}
                  aria-grabbed={draggingLessonId === lesson.lesson_id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <GripVertical
                        className={cn(
                          "h-4 w-4 text-muted-foreground",
                          isPendingLesson ? "cursor-not-allowed opacity-60" : "cursor-grab active:cursor-grabbing",
                        )}
                        aria-hidden="true"
                      />
                      <Link
                        href={`/lessons/${encodeURIComponent(lesson.lesson_id)}`}
                        className="truncate text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {lesson.title?.trim().length ? lesson.title : "Untitled lesson"}
                      </Link>
                      {isPendingLesson ? (
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          Pending
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {isPendingLesson ? (
                        <span className="text-sm text-muted-foreground">Waiting for creation…</span>
                      ) : (
                        <>
                          <Button asChild size="sm" variant="secondary" className="whitespace-nowrap">
                            <Link
                              href={`/lessons/${encodeURIComponent(lesson.lesson_id)}/activities`}
                              onClick={(event) => {
                                event.stopPropagation()
                              }}
                            >
                              Show activities
                            </Link>
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No active lessons yet. Click “Add Lesson” to create the first one.
          </div>
        )}
      </CardContent>

      <LessonSidebar
        unitId={unitId}
        unitTitle={unitTitle}
        lesson={selectedLesson}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onCreateOrUpdate={upsertLesson}
        onDeactivate={deactivateLesson}
        learningObjectives={learningObjectives}
        onLessonJobQueued={handleLessonJobQueued}
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
