"use client"

import Link from "next/link"
import { useCallback, useState, useTransition } from "react"
import { BookOpen, GripVertical, Plus, ChevronRight } from "lucide-react"

import type { LessonWithObjectives, LearningObjectiveWithCriteria } from "@/lib/server-updates"
import {
  getActivityFileDownloadUrlAction,
  getLessonFileDownloadUrlAction,
  reorderLessonsAction,
} from "@/lib/server-updates"
import type { LessonActivity } from "@/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  LessonSidebar,
  LessonActivitiesSidebar,
  LessonResourcesSidebar,
  LessonPresentation,
  type LessonFileInfo,
  type LessonLinkInfo,
} from "@/components/units/lesson-sidebar"
import { LessonObjectivesSidebar } from "@/components/units/lesson-objectives-sidebar"
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
  const [objectivesLesson, setObjectivesLesson] = useState<LessonWithObjectives | null>(null)
  const [isObjectivesSidebarOpen, setIsObjectivesSidebarOpen] = useState(false)
  const [activitiesLesson, setActivitiesLesson] = useState<LessonWithObjectives | null>(null)
  const [isActivitiesSidebarOpen, setIsActivitiesSidebarOpen] = useState(false)
  const [resourcesLesson, setResourcesLesson] = useState<LessonWithObjectives | null>(null)
  const [isResourcesSidebarOpen, setIsResourcesSidebarOpen] = useState(false)
  const [presentationState, setPresentationState] = useState<PresentationState | null>(null)
  const [presentationIndex, setPresentationIndex] = useState(-1)
  const [draggingLessonId, setDraggingLessonId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [, startTransition] = useTransition()
  const [expandedLessons, setExpandedLessons] = useState<Record<string, boolean>>({})

  const openCreateSidebar = () => {
    setSelectedLesson(null)
    setIsSidebarOpen(true)
  }

  const handleLessonClick = (lesson: LessonWithObjectives) => {
    if (isDragging) return
    setSelectedLesson(lesson)
    setIsSidebarOpen(true)
  }

  const openObjectivesSidebar = (lesson: LessonWithObjectives) => {
    setObjectivesLesson(lesson)
    setIsObjectivesSidebarOpen(true)
  }

  const closeObjectivesSidebar = () => {
    setIsObjectivesSidebarOpen(false)
    setObjectivesLesson(null)
  }

  const openActivitiesSidebar = (lesson: LessonWithObjectives) => {
    setActivitiesLesson(lesson)
    setIsActivitiesSidebarOpen(true)
  }

  const closeActivitiesSidebar = () => {
    setIsActivitiesSidebarOpen(false)
    setActivitiesLesson(null)
  }

  const openResourcesSidebar = (lesson: LessonWithObjectives) => {
    setResourcesLesson(lesson)
    setIsResourcesSidebarOpen(true)
  }

  const closeResourcesSidebar = () => {
    setIsResourcesSidebarOpen(false)
    setResourcesLesson(null)
  }

  const handleActivitiesChange = useCallback(
    (lessonId: string, updatedActivities: LessonActivity[]) => {
      setPresentationState((prev) => {
        if (!prev || prev.lesson.lesson_id !== lessonId) {
          return prev
        }
        return { ...prev, activities: updatedActivities }
      })
      if (presentationState?.lesson.lesson_id === lessonId) {
        setPresentationIndex((prev) => {
          if (prev < 0) return prev
          const maxIndex = updatedActivities.length - 1
          return prev > maxIndex ? maxIndex : prev
        })
      }
    },
    [presentationState],
  )

  const handleResourcesChange = useCallback(
    (
      lessonId: string,
      changes: { links?: LessonLinkInfo[]; files?: LessonFileInfo[] },
    ) => {
      setLessons((prev) =>
        prev.map((lesson) =>
          lesson.lesson_id === lessonId
            ? {
                ...lesson,
                ...(changes.links ? { lesson_links: changes.links } : {}),
              }
            : lesson,
        ),
      )

      const applyUpdate = (lesson: LessonWithObjectives | null) =>
        lesson && lesson.lesson_id === lessonId
          ? {
              ...lesson,
              ...(changes.links ? { lesson_links: changes.links } : {}),
            }
          : lesson

      setSelectedLesson(applyUpdate)
      setObjectivesLesson(applyUpdate)
      setActivitiesLesson(applyUpdate)
      setResourcesLesson(applyUpdate)

      setPresentationState((prev) => {
        if (!prev || prev.lesson.lesson_id !== lessonId) {
          return prev
        }
        return {
          ...prev,
          lesson: {
            ...prev.lesson,
            ...(changes.links ? { lesson_links: changes.links } : {}),
          },
          ...(changes.links ? { links: changes.links } : {}),
          ...(changes.files ? { files: changes.files } : {}),
        }
      })
    },
    [],
  )

  const toggleLessonDetails = useCallback((lessonId: string) => {
    setExpandedLessons((prev) => ({
      ...prev,
      [lessonId]: !prev[lessonId],
    }))
  }, [])

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
    setPresentationState((prev) =>
      prev && prev.lesson.lesson_id === lesson.lesson_id
        ? { ...prev, lesson }
        : prev,
    )
    setObjectivesLesson((prev) => (prev && prev.lesson_id === lesson.lesson_id ? lesson : prev))
    setActivitiesLesson((prev) => (prev && prev.lesson_id === lesson.lesson_id ? lesson : prev))
    setResourcesLesson((prev) => (prev && prev.lesson_id === lesson.lesson_id ? lesson : prev))
  }

  const deactivateLesson = (lessonId: string) => {
    setLessons((prev) =>
      prev
        .map((lesson) =>
          lesson.lesson_id === lessonId ? { ...lesson, active: false } : lesson,
        )
        .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0)),
    )
    setPresentationState((prev) => (prev?.lesson.lesson_id === lessonId ? null : prev))
    if (presentationState?.lesson.lesson_id === lessonId) {
      setPresentationIndex(-1)
    }
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
            {activeLessons.map((lesson) => {
              const isExpanded = expandedLessons[lesson.lesson_id] ?? false
              const detailsSectionId = `lesson-details-${lesson.lesson_id}`

              return (
                <div
                  key={lesson.lesson_id}
                  draggable
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
                        className="h-4 w-4 cursor-grab text-muted-foreground active:cursor-grabbing"
                        aria-hidden="true"
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          toggleLessonDetails(lesson.lesson_id)
                        }}
                        aria-expanded={isExpanded}
                        aria-controls={detailsSectionId}
                        className="flex flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-medium text-foreground transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform",
                            isExpanded && "rotate-90",
                          )}
                        />
                        <span className="truncate">
                          {lesson.title?.trim().length ? lesson.title : "Untitled lesson"}
                        </span>
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
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
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/lessons/${lesson.lesson_id}`}>Details</Link>
                      </Button>
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

                  {isExpanded ? (
                    <div
                      id={detailsSectionId}
                      className="mt-4 space-y-4 border-t border-border pt-4"
                    >
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            openObjectivesSidebar(lesson)
                          }}
                          className="text-left text-sm font-semibold text-muted-foreground underline-offset-2 hover:underline"
                        >
                          Learning objectives
                        </button>
                        {lesson.lesson_objectives && lesson.lesson_objectives.length > 0 ? (
                          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {lesson.lesson_objectives.map((objective) => (
                              <li key={objective.learning_objective_id}>
                                {objective.learning_objective?.title ?? objective.title}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">No learning objectives yet.</p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          openActivitiesSidebar(lesson)
                        }}
                        className="text-left text-sm font-semibold text-muted-foreground underline-offset-2 hover:underline"
                      >
                        Activities
                      </button>

                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            openResourcesSidebar(lesson)
                          }}
                          className="text-left text-sm font-semibold text-muted-foreground underline-offset-2 hover:underline"
                        >
                          Links &amp; files
                        </button>
                        {lesson.lesson_links && lesson.lesson_links.length > 0 ? (
                          <ul className="space-y-1 text-sm text-muted-foreground">
                            {lesson.lesson_links.map((link) => (
                              <li key={link.lesson_link_id}>
                                {link.description ? (
                                  <span>{link.description}</span>
                                ) : (
                                  <a
                                    href={link.url}
                                    className="text-primary underline-offset-2 hover:underline"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {link.url}
                                  </a>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">No links added yet.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
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
      />
      <LessonActivitiesSidebar
        unitId={unitId}
        unitTitle={unitTitle}
        lesson={activitiesLesson}
        isOpen={isActivitiesSidebarOpen}
        onClose={closeActivitiesSidebar}
        learningObjectives={learningObjectives}
        onActivitiesChange={handleActivitiesChange}
        onLessonUpdated={upsertLesson}
        onDeactivate={deactivateLesson}
      />
      <LessonResourcesSidebar
        unitId={unitId}
        unitTitle={unitTitle}
        lesson={resourcesLesson}
        isOpen={isResourcesSidebarOpen}
        onClose={closeResourcesSidebar}
        learningObjectives={learningObjectives}
        onResourcesChange={handleResourcesChange}
        onLessonUpdated={upsertLesson}
        onDeactivate={deactivateLesson}
      />
      <LessonObjectivesSidebar
        unitId={unitId}
        lesson={objectivesLesson}
        availableObjectives={learningObjectives}
        isOpen={isObjectivesSidebarOpen}
        onClose={closeObjectivesSidebar}
        onUpdate={(updatedLesson) => {
          upsertLesson(updatedLesson)
        }}
      />
      {presentationState ? (
        <>
          <LessonPresentation
            activities={presentationState.activities}
            currentIndex={presentationIndex}
            unitTitle={unitTitle}
            lessonTitle={presentationState.lesson.title}
            lessonId={presentationState.lesson.lesson_id}
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
