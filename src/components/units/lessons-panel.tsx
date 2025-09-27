"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import { BookOpen, GripVertical, Plus } from "lucide-react"

import type { LessonWithObjectives, LearningObjectiveWithCriteria } from "@/lib/server-updates"
import {
  getActivityFileDownloadUrlAction,
  getLessonFileDownloadUrlAction,
  listActivityFilesAction,
  listLessonActivitiesAction,
  listLessonFilesAction,
  listLessonLinksAction,
  reorderLessonsAction,
} from "@/lib/server-updates"
import type { LessonActivity } from "@/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  LessonSidebar,
  LessonPresentation,
  type LessonFileInfo,
  type LessonLinkInfo,
} from "@/components/units/lesson-sidebar"
import { toast } from "sonner"

interface LessonsPanelProps {
  unitId: string
  unitTitle: string
  initialLessons: LessonWithObjectives[]
  learningObjectives: LearningObjectiveWithCriteria[]
}

interface PresentationState {
  lesson: LessonWithObjectives
  activities: LessonActivity[]
  files: LessonFileInfo[]
  links: LessonLinkInfo[]
  activityFilesMap: Record<string, LessonFileInfo[]>
  loading: boolean
}

export function LessonsPanel({ unitId, unitTitle, initialLessons, learningObjectives }: LessonsPanelProps) {
  const [lessons, setLessons] = useState(() =>
    [...initialLessons].sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0)),
  )
  const [selectedLesson, setSelectedLesson] = useState<LessonWithObjectives | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [presentationState, setPresentationState] = useState<PresentationState | null>(null)
  const [presentationIndex, setPresentationIndex] = useState(-1)
  const [draggingLessonId, setDraggingLessonId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [, startTransition] = useTransition()
  const [lessonActivityCounts, setLessonActivityCounts] = useState<Record<string, number>>({})
  const [lessonActivitiesMap, setLessonActivitiesMap] = useState<Record<string, LessonActivity[]>>({})

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
    setLessonActivityCounts((prev) => {
      const next = { ...prev }
      delete next[lesson.lesson_id]
      return next
    })
    setLessonActivitiesMap((prev) => {
      const next = { ...prev }
      delete next[lesson.lesson_id]
      return next
    })
    setPresentationState((prev) =>
      prev && prev.lesson.lesson_id === lesson.lesson_id
        ? { ...prev, lesson }
        : prev,
    )
  }

  const deactivateLesson = (lessonId: string) => {
    setLessons((prev) =>
      prev
        .map((lesson) =>
          lesson.lesson_id === lessonId ? { ...lesson, active: false } : lesson,
        )
        .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0)),
    )
    setLessonActivityCounts((prev) => {
      const next = { ...prev }
      delete next[lessonId]
      return next
    })
    setLessonActivitiesMap((prev) => {
      const next = { ...prev }
      delete next[lessonId]
      return next
    })
    setPresentationState((prev) => (prev?.lesson.lesson_id === lessonId ? null : prev))
    if (presentationState?.lesson.lesson_id === lessonId) {
      setPresentationIndex(-1)
    }
  }

  const activeLessons = lessons.filter((lesson) => lesson.active !== false)

  useEffect(() => {
    const missingLessons = activeLessons.filter(
      (lesson) => lessonActivityCounts[lesson.lesson_id] === undefined,
    )

    if (missingLessons.length === 0) {
      return
    }

    let isCancelled = false

    startTransition(async () => {
      const entries: Array<[string, LessonActivity[]]> = []
      for (const lesson of missingLessons) {
        const result = await listLessonActivitiesAction(lesson.lesson_id)
        if (result.error) {
          toast.error("Failed to load activities", {
            description: result.error,
          })
          continue
        }
        const activities = (result.data ?? []).slice()
        entries.push([lesson.lesson_id, activities])
      }

      if (isCancelled || entries.length === 0) {
        return
      }

      setLessonActivityCounts((prev) => {
        const next = { ...prev }
        for (const [lessonId, activities] of entries) {
          next[lessonId] = activities.length
        }
        return next
      })

      setLessonActivitiesMap((prev) => {
        const next = { ...prev }
        for (const [lessonId, activities] of entries) {
          next[lessonId] = activities
        }
        return next
      })
    })

    return () => {
      isCancelled = true
    }
  }, [activeLessons, lessonActivityCounts, startTransition])

  const handleShowActivities = (lesson: LessonWithObjectives) => {
    if (!lesson) return
    if (lessonActivityCounts[lesson.lesson_id] === 0) {
      return
    }

    const cachedActivities = lessonActivitiesMap[lesson.lesson_id]

    setPresentationState({
      lesson,
      activities: cachedActivities ?? [],
      files: [],
      links: [],
      activityFilesMap: {},
      loading: true,
    })
    setPresentationIndex(-1)

    startTransition(async () => {
      try {
        let activities = cachedActivities

        if (!activities) {
          const activitiesResult = await listLessonActivitiesAction(lesson.lesson_id)
          if (activitiesResult.error) {
            throw new Error(activitiesResult.error)
          }
          activities = (activitiesResult.data ?? []).slice()
          setLessonActivitiesMap((prev) => ({ ...prev, [lesson.lesson_id]: activities! }))
          setLessonActivityCounts((prev) => ({ ...prev, [lesson.lesson_id]: activities!.length }))
        }

        if (!activities || activities.length === 0) {
          toast.info("This lesson doesn't have any activities yet.")
          setPresentationState(null)
          setPresentationIndex(-1)
          return
        }

        const [filesResult, linksResult] = await Promise.all([
          listLessonFilesAction(lesson.lesson_id),
          listLessonLinksAction(lesson.lesson_id),
        ])

        if (filesResult.error) {
          toast.error("Failed to load lesson files", {
            description: filesResult.error,
          })
        }
        if (linksResult.error) {
          toast.error("Failed to load lesson links", {
            description: linksResult.error,
          })
        }

        const files = filesResult.data ?? []
        const links = linksResult.data ?? []

        const activitiesRequiringFiles = activities.filter(
          (activity) => activity.type === "file-download" || activity.type === "voice",
        )

        const activityFilesEntries = await Promise.all(
          activitiesRequiringFiles.map(async (activity) => {
            const result = await listActivityFilesAction(lesson.lesson_id, activity.activity_id)
            if (result.error) {
              toast.error("Failed to load activity files", {
                description: result.error,
              })
              return [activity.activity_id, []] as const
            }
            return [activity.activity_id, result.data ?? []] as const
          }),
        )

        const activityFilesMap = Object.fromEntries(activityFilesEntries)

        setPresentationState((prev) => {
          if (!prev || prev.lesson.lesson_id !== lesson.lesson_id) {
            return prev
          }
          return {
            lesson,
            activities,
            files,
            links,
            activityFilesMap,
            loading: false,
          }
        })
      } catch (error) {
        console.error("[lessons-panel] Failed to open presentation:", error)
        toast.error("Unable to load activities", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
        setPresentationState(null)
        setPresentationIndex(-1)
      }
    })
  }

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
              <div
                key={lesson.lesson_id}
                draggable
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
                    <Link
                      href={`/lessons/${lesson.lesson_id}`}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {lesson.title}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {lesson.active === false ? "Inactive" : "Active"}
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        handleLessonClick(lesson)
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    {lesson.lesson_objectives && lesson.lesson_objectives.length > 0 ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {lesson.lesson_objectives.map((objective) => (
                          <li key={objective.learning_objective_id}>
                            {objective.learning_objective?.title ?? objective.title}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Drag the handle to reorder this lesson or use the Edit button for changes.
                      </p>
                    )}
                  </div>
                 <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      handleShowActivities(lesson)
                    }}
                    className="whitespace-nowrap"
                    disabled={lessonActivityCounts[lesson.lesson_id] === 0}
                  >
                    {`Show Activities (${lessonActivityCounts[lesson.lesson_id] ?? "…"})`}
                  </Button>
                </div>
                {lesson.lesson_links && lesson.lesson_links.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {lesson.lesson_links.map((link) => (
                      <li key={link.lesson_link_id}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {link.description || link.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
        unitTitle={unitTitle}
        lesson={selectedLesson}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onCreateOrUpdate={upsertLesson}
        onDeactivate={deactivateLesson}
        learningObjectives={learningObjectives}
      />
      {presentationState ? (
        <>
          <LessonPresentation
            activities={presentationState.activities}
            currentIndex={presentationIndex}
            unitTitle={unitTitle}
            lessonTitle={presentationState.lesson.title}
            lessonObjectives={presentationState.lesson.lesson_objectives ?? []}
            lessonLinks={presentationState.links}
            lessonFiles={presentationState.files}
            activityFilesMap={presentationState.activityFilesMap}
            onClose={() => {
              setPresentationState(null)
              setPresentationIndex(-1)
            }}
            onNext={() => {
              setPresentationIndex((prev) => {
                const total = presentationState.activities.length
                if (total === 0) return prev
                if (prev < 0) return 0
                if (prev < total - 1) return prev + 1
                return prev
              })
            }}
            onPrevious={() => {
              setPresentationIndex((prev) => (prev <= 0 ? -1 : prev - 1))
            }}
            onDownloadFile={(fileName) => {
              const currentLessonId = presentationState.lesson.lesson_id
              startTransition(async () => {
                const result = await getLessonFileDownloadUrlAction(currentLessonId, fileName)
                if (!result.success || !result.url) {
                  toast.error("Failed to download file", {
                    description: result.error ?? "Please try again later.",
                  })
                  return
                }
                window.open(result.url, "_blank")
              })
            }}
            onDownloadActivityFile={(activityId, fileName) => {
              const currentLessonId = presentationState.lesson.lesson_id
              startTransition(async () => {
                const result = await getActivityFileDownloadUrlAction(currentLessonId, activityId, fileName)
                if (!result.success || !result.url) {
                  toast.error("Failed to download activity file", {
                    description: result.error ?? "Please try again later.",
                  })
                  return
                }
                window.open(result.url, "_blank")
              })
            }}
            fetchActivityFileUrl={async (activityId, fileName) => {
              const lessonId = presentationState.lesson.lesson_id
              const result = await getActivityFileDownloadUrlAction(lessonId, activityId, fileName)
              if (!result.success || !result.url) {
                toast.error("Failed to load file", {
                  description: result.error ?? "Please try again later.",
                })
                return null
              }
              return result.url
            }}
          />
          {presentationState.loading ? (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40">
              <div className="rounded-md bg-background px-4 py-2 text-sm text-foreground shadow-md">
                Loading activities…
              </div>
            </div>
          ) : null}
        </>
      ) : null}
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
