"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { BookOpen, Globe, GripVertical, Layers, Pencil, Plus } from "lucide-react"

import type { LessonWithObjectives, LearningObjectiveWithCriteria } from "@/lib/server-updates"
import { toggleLessonActiveAction, toggleLessonPublicAction } from "@/lib/server-updates"
import { LessonJobPayloadSchema, type SubUnit } from "@/types"
import { arrangeLessonsAction } from "@/lib/server-actions/sub-units"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LessonSidebar } from "@/components/units/lesson-sidebar"
import { SubUnitSidebar, type SubUnitLessonsChoice } from "@/components/units/sub-unit-sidebar"
import { LessonPlanDownloadButton } from "@/components/pdf/lesson-plan-download-button"
import { toast } from "sonner"

interface LessonsPanelProps {
  unitId: string
  unitTitle: string
  initialLessons: LessonWithObjectives[]
  initialSubUnits: SubUnit[]
  learningObjectives: LearningObjectiveWithCriteria[]
}

const LESSON_CHANNEL_NAME = "lesson_updates"
const LESSON_CREATED_EVENT = "lesson:created"
const LESSON_SSE_URL = "/sse?topics=lessons"

export function LessonsPanel({ unitId, unitTitle, initialLessons, initialSubUnits, learningObjectives }: LessonsPanelProps) {
  const [lessons, setLessons] = useState(() =>
    [...initialLessons].sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0)),
  )
  const [showInactive, setShowInactive] = useState(false)
  const pendingLessonJobsRef = useRef(new Map<string, { title: string }>())
  const [pendingLessonIds, setPendingLessonIds] = useState<Record<string, boolean>>({})
  const [selectedLesson, setSelectedLesson] = useState<LessonWithObjectives | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [draggingLessonId, setDraggingLessonId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dropSubUnitId, setDropSubUnitId] = useState<string | null>(null)
  const [subUnits, setSubUnits] = useState<SubUnit[]>(initialSubUnits)
  const [editingSubUnit, setEditingSubUnit] = useState<SubUnit | null>(null)
  const [isSubUnitSidebarOpen, setIsSubUnitSidebarOpen] = useState(false)
  const [, startTransition] = useTransition()
  const pageLoadTimeRef = useRef<number>(Date.now())

  const openCreateSidebar = () => {
    setSelectedLesson(null)
    setIsSidebarOpen(true)
  }

  const openSubUnitSidebar = (subUnit: SubUnit | null) => {
    setEditingSubUnit(subUnit)
    setIsSubUnitSidebarOpen(true)
  }

  const handleSubUnitSaved = (subUnit: SubUnit, choice: SubUnitLessonsChoice | null) => {
    setSubUnits((prev) =>
      prev.some((item) => item.sub_unit_id === subUnit.sub_unit_id)
        ? prev.map((item) => (item.sub_unit_id === subUnit.sub_unit_id ? subUnit : item))
        : [...prev, subUnit],
    )
    if (choice === null) return
    setLessons((prev) =>
      prev.map((lesson) => {
        if (lesson.sub_unit_id !== subUnit.sub_unit_id) return lesson
        return choice === "deactivate" ? { ...lesson, active: false } : { ...lesson, sub_unit_id: null }
      }),
    )
  }

  const upsertLesson = useCallback((lesson: LessonWithObjectives) => {
    setLessons((prev) => {
      const existingIndex = prev.findIndex((item) => item.lesson_id === lesson.lesson_id)
      if (existingIndex !== -1) {
        const next = [...prev]
        // A saved lesson may come back without its grouping; keep it.
        next[existingIndex] = { ...lesson, sub_unit_id: lesson.sub_unit_id ?? prev[existingIndex].sub_unit_id ?? null }
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
          is_public: false,
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

  const handleTogglePublic = (lessonId: string, currentValue: boolean) => {
    const next = !currentValue
    setLessons((prev) =>
      prev.map((l) => (l.lesson_id === lessonId ? { ...l, is_public: next } : l)),
    )
    startTransition(async () => {
      const result = await toggleLessonPublicAction(lessonId, next)
      if (result.error) {
        toast.error("Failed to update published status")
        setLessons((prev) =>
          prev.map((l) => (l.lesson_id === lessonId ? { ...l, is_public: currentValue } : l)),
        )
      }
    })
  }

  const handleToggleActive = (lessonId: string, checked: boolean) => {
    setLessons((prev) =>
      prev.map((l) => (l.lesson_id === lessonId ? { ...l, active: checked } : l)),
    )
    startTransition(async () => {
      const result = await toggleLessonActiveAction(lessonId, unitId, checked)
      if (!result.success) {
        toast.error("Failed to update status")
        setLessons((prev) =>
          prev.map((l) => (l.lesson_id === lessonId ? { ...l, active: !checked } : l)),
        )
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
    setDropSubUnitId(null)
  }

  // A drop lands on a lesson (taking its place, and its sub unit), on a sub
  // unit (joining it at the end), or on the panel itself (back to the unit
  // level, at the end).
  const handleDrop = (target: DropTarget) => (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!draggingLessonId || (target.kind === "lesson" && target.lessonId === draggingLessonId)) {
      handleDragEnd()
      return
    }

    const result = arrangeLessons(lessons, draggingLessonId, target)
    if (!result) {
      handleDragEnd()
      return
    }

    const { updatedLessons, payload } = result
    const previousLessons = lessons

    setLessons(updatedLessons)
    handleDragEnd()

    startTransition(async () => {
      // Lessons still being created have no row to update yet.
      const saved = payload.filter((row) => !pendingLessonIds[row.lessonId])
      const response = await arrangeLessonsAction(unitId, saved)
      if (!response.success) {
        toast.error("Failed to update lesson order", {
          description: response.error ?? "Please try again shortly.",
        })
        setLessons(previousLessons)
      } else {
        toast.success("Lesson order updated")
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

      setPendingLessonIds((prev) => {
        const { [jobId]: _removed, ...rest } = prev
        return rest
      })
      pendingLessonJobsRef.current.delete(jobId)

      setLessons((prev) => {
        const next = prev.filter((lesson) => lesson.lesson_id !== jobId)

        if (payload.status === "completed" && payload.lesson) {
          const newLesson = payload.lesson
          const existingIndex = next.findIndex((item) => item.lesson_id === newLesson.lesson_id)
          if (existingIndex !== -1) {
            next[existingIndex] = newLesson
          } else {
            next.push(newLesson)
          }
          return next.sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
        }

        return next
      })

      if (payload.status === "completed") {
        const eventType = (payload as { operation?: string }).operation ?? envelope.type ?? "unknown"
        const description = `event=${eventType} · status=${payload.status} · job=${payload.job_id ?? "n/a"}`
        console.debug("[lessons:sse] toast trigger", {
          unitId,
          lessonId: payload.lesson_id ?? null,
          status: payload.status,
          message: payload.message,
          eventType,
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

  const displayedLessons = lessons.filter((lesson) => showInactive || lesson.active !== false)

  // Numbered across the active lessons only, because that is what dragging
  // reorders — handleReorder assigns order_by over the active list. Numbering
  // whatever happens to be on screen would renumber every lesson when "Show
  // inactive" is toggled, and the number would stop matching the saved order.
  // Inactive lessons therefore carry no number rather than a misleading one.
  // Sub units do not restart the count: they group lessons, they do not
  // reorder them.
  const lessonNumbers = useMemo(() => {
    const numbers = new Map<string, number>()
    let position = 0
    for (const lesson of lessons) {
      if (lesson.active !== false) numbers.set(lesson.lesson_id, ++position)
    }
    return numbers
  }, [lessons])

  const blocks = buildBlocks(displayedLessons, subUnits, showInactive)
  const subUnitLessonCount = (subUnitId: string) =>
    lessons.filter((lesson) => lesson.sub_unit_id === subUnitId && lesson.active !== false).length

  const renderLesson = (lesson: LessonWithObjectives) => {
    const lessonNumber = lessonNumbers.get(lesson.lesson_id) ?? null
    const isPendingLesson = pendingLessonIds[lesson.lesson_id] === true
    const isActive = lesson.active !== false

    return (
      <div
        key={lesson.lesson_id}
        draggable={!isPendingLesson}
        onDragStart={(event) => handleDragStart(lesson.lesson_id, event)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop({ kind: "lesson", lessonId: lesson.lesson_id })}
        onDragEnd={handleDragEnd}
        className={cn(
          "w-full rounded-lg border border-border p-4 text-left transition hover:border-primary",
          draggingLessonId === lesson.lesson_id && "opacity-60",
          !isActive && "bg-muted/40",
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
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <Link
                  href={`/lessons/${encodeURIComponent(lesson.lesson_id)}`}
                  className={cn(
                    "truncate text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    !isActive && "text-muted-foreground",
                  )}
                >
                  {lessonNumber ? `${lessonNumber}. ` : ""}
                  {lesson.title?.trim().length ? lesson.title : "Untitled lesson"}
                </Link>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (!isPendingLesson) handleTogglePublic(lesson.lesson_id, lesson.is_public ?? false)
                  }}
                  title={lesson.is_public ? "Published — click to unpublish" : "Not published — click to publish"}
                  className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={isPendingLesson}
                >
                  <Globe
                    className={cn(
                      "h-3.5 w-3.5 transition-colors",
                      lesson.is_public
                        ? "text-emerald-500 hover:text-emerald-600"
                        : "text-muted-foreground/40 hover:text-muted-foreground",
                    )}
                  />
                </button>
              </div>
              {!isActive && <span className="text-xs text-muted-foreground">Inactive</span>}
            </div>

            {isPendingLesson ? (
              <Badge variant="secondary" className="shrink-0 text-xs">
                Pending
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Switch
                id={`lesson-active-${lesson.lesson_id}`}
                checked={isActive}
                onCheckedChange={(checked) => handleToggleActive(lesson.lesson_id, checked)}
                disabled={isPendingLesson}
              />
              <Label
                htmlFor={`lesson-active-${lesson.lesson_id}`}
                className="text-xs text-muted-foreground"
              >
                Active
              </Label>
            </div>
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
                <div onClick={(e) => e.stopPropagation()}>
                  <LessonPlanDownloadButton lessonId={lesson.lesson_id} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderSubUnit = (subUnit: SubUnit, subUnitLessons: LessonWithObjectives[]) => {
    const isTarget = dropSubUnitId === subUnit.sub_unit_id
    return (
      <section
        key={subUnit.sub_unit_id}
        aria-label={`Sub unit: ${subUnit.title}`}
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (isDragging) setDropSubUnitId(subUnit.sub_unit_id)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropSubUnitId(null)
        }}
        onDrop={handleDrop({ kind: "subUnit", subUnitId: subUnit.sub_unit_id })}
        className={cn(
          "rounded-xl border-2 border-dashed border-border bg-muted/30 p-3 transition",
          isTarget && "border-primary bg-primary/5",
          !subUnit.active && "opacity-70",
        )}
      >
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2 px-1">
          <div className="min-w-0 space-y-0.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4 text-primary" aria-hidden="true" />
              {subUnit.title}
              {!subUnit.active ? (
                <Badge variant="secondary" className="text-xs">
                  Inactive
                </Badge>
              ) : null}
            </h3>
            {subUnit.description ? <p className="text-xs text-muted-foreground">{subUnit.description}</p> : null}
          </div>
          <Button size="sm" variant="ghost" onClick={() => openSubUnitSidebar(subUnit)}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
        {subUnitLessons.length > 0 ? (
          <div className="space-y-3">{subUnitLessons.map(renderLesson)}</div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Drag lessons here to add them to this sub unit.
          </div>
        )}
      </section>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-xl font-semibold">
            <BookOpen className="h-5 w-5 text-primary" />
            Lessons
          </CardTitle>
          <CardDescription>Manage lesson visibility and order.</CardDescription>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="show-inactive"
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <Label htmlFor="show-inactive" className="text-sm font-medium">
              Show inactive
            </Label>
          </div>
          <Button size="sm" variant="outline" onClick={() => openSubUnitSidebar(null)}>
            <Layers className="mr-2 h-4 w-4" />
            Add Sub Unit
          </Button>
          <Button size="sm" onClick={openCreateSidebar}>
            <Plus className="mr-2 h-4 w-4" />
            Add Lesson
          </Button>
        </div>
      </CardHeader>
      <CardContent onDragOver={(event) => event.preventDefault()} onDrop={handleDrop({ kind: "unit" })}>
        {blocks.length > 0 ? (
          <div className="space-y-3">
            {blocks.map((block) =>
              block.kind === "lesson" ? renderLesson(block.lesson) : renderSubUnit(block.subUnit, block.lessons),
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No lessons yet. Click “Add Lesson” to create the first one.
          </div>
        )}
      </CardContent>

      <SubUnitSidebar
        unitId={unitId}
        subUnit={editingSubUnit}
        lessonCount={editingSubUnit ? subUnitLessonCount(editingSubUnit.sub_unit_id) : 0}
        isOpen={isSubUnitSidebarOpen}
        onClose={() => setIsSubUnitSidebarOpen(false)}
        onSaved={handleSubUnitSaved}
      />

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

type DropTarget =
  | { kind: "lesson"; lessonId: string }
  | { kind: "subUnit"; subUnitId: string }
  | { kind: "unit" }

type Block =
  | { kind: "lesson"; lesson: LessonWithObjectives }
  | { kind: "subUnit"; subUnit: SubUnit; lessons: LessonWithObjectives[] }

/**
 * The panel's top-level items in lesson order. A sub unit sits where its
 * first lesson does, holding all of its lessons; one with none showing goes
 * at the end. arrangeLessons keeps a sub unit's lessons next to each other,
 * so this never splits one.
 */
function buildBlocks(lessons: LessonWithObjectives[], subUnits: SubUnit[], showInactive: boolean): Block[] {
  const byId = new Map(subUnits.map((subUnit) => [subUnit.sub_unit_id, subUnit]))
  const blocks: Block[] = []
  const placed = new Map<string, LessonWithObjectives[]>()
  for (const lesson of lessons) {
    const subUnit = lesson.sub_unit_id ? byId.get(lesson.sub_unit_id) : undefined
    if (!subUnit) {
      blocks.push({ kind: "lesson", lesson })
      continue
    }
    const group = placed.get(subUnit.sub_unit_id)
    if (group) {
      group.push(lesson)
    } else {
      const fresh = [lesson]
      placed.set(subUnit.sub_unit_id, fresh)
      blocks.push({ kind: "subUnit", subUnit, lessons: fresh })
    }
  }
  for (const subUnit of subUnits) {
    if (placed.has(subUnit.sub_unit_id) || (!subUnit.active && !showInactive)) continue
    blocks.push({ kind: "subUnit", subUnit, lessons: [] })
  }
  return blocks
}

/**
 * Move one lesson and renumber the whole unit. Lessons are laid out as
 * top-level items, a sub unit being one item holding its lessons, so a sub
 * unit's lessons always stay together and keep one order across the unit.
 */
function arrangeLessons(
  lessons: LessonWithObjectives[],
  draggedLessonId: string,
  target: DropTarget,
):
  | {
      updatedLessons: LessonWithObjectives[]
      payload: { lessonId: string; orderBy: number; subUnitId: string | null }[]
    }
  | null {
  const sorted = [...lessons].sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
  const dragged = sorted.find((lesson) => lesson.lesson_id === draggedLessonId)
  if (!dragged) return null
  const draggedIndex = sorted.indexOf(dragged)

  type Item = { lesson: LessonWithObjectives } | { subUnitId: string; lessons: LessonWithObjectives[] }
  const items: Item[] = []
  const groups = new Map<string, LessonWithObjectives[]>()
  for (const lesson of sorted) {
    if (lesson.lesson_id === draggedLessonId) continue
    if (!lesson.sub_unit_id) {
      items.push({ lesson })
      continue
    }
    const group = groups.get(lesson.sub_unit_id)
    if (group) {
      group.push(lesson)
    } else {
      const fresh = [lesson]
      groups.set(lesson.sub_unit_id, fresh)
      items.push({ subUnitId: lesson.sub_unit_id, lessons: fresh })
    }
  }

  let subUnitId: string | null = null
  if (target.kind === "unit") {
    items.push({ lesson: dragged })
  } else if (target.kind === "subUnit") {
    subUnitId = target.subUnitId
    const group = groups.get(subUnitId)
    if (group) group.push(dragged)
    else items.push({ subUnitId, lessons: [dragged] })
  } else {
    const targetLesson = sorted.find((lesson) => lesson.lesson_id === target.lessonId)
    if (!targetLesson) return null
    // Dragging down lands after the target, dragging up before it.
    const offset = sorted.indexOf(targetLesson) > draggedIndex ? 1 : 0
    subUnitId = targetLesson.sub_unit_id ?? null
    const list = subUnitId
      ? groups.get(subUnitId)!
      : (items as Array<{ lesson?: LessonWithObjectives }>).map((item) => item.lesson ?? null)
    const at = list.findIndex((lesson) => lesson?.lesson_id === targetLesson.lesson_id) + offset
    if (subUnitId) groups.get(subUnitId)!.splice(at, 0, dragged)
    else items.splice(at, 0, { lesson: dragged })
  }

  const ordered = items.flatMap((item) => ("lesson" in item ? [item.lesson] : item.lessons))
  const updatedLessons = ordered.map((lesson, index) => ({
    ...lesson,
    order_by: index,
    sub_unit_id: lesson.lesson_id === draggedLessonId ? subUnitId : (lesson.sub_unit_id ?? null),
  }))

  const unchanged = updatedLessons.every(
    (lesson, index) =>
      lesson.lesson_id === sorted[index].lesson_id && (lesson.sub_unit_id ?? null) === (sorted[index].sub_unit_id ?? null),
  )
  if (unchanged) return null

  const payload = updatedLessons.map((lesson) => ({ lessonId: lesson.lesson_id, orderBy: lesson.order_by, subUnitId: lesson.sub_unit_id ?? null }))

  return { updatedLessons, payload }
}
