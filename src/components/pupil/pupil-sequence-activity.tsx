"use client"

import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"

import { upsertSequenceSubmissionAction } from "@/lib/server-updates"
import { SequenceSubmissionBodySchema } from "@/types"
import { cn } from "@/lib/utils"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"
import { useFeedbackVisibility } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug"

interface SequenceTermOption {
  id: string
  text: string
}

interface PupilSequenceActivityProps {
  lessonId: string
  activityId: string
  pupilId: string
  canAnswer: boolean
  /** Terms in the pupil's current display order (never the correct order). */
  terms: SequenceTermOption[]
  /** Ids forming the longest correct run in the latest attempt (for highlighting). */
  initialCorrectIds: string[]
  initialAttempts: number
}

/** Move `activeId` to sit before `overId`, preserving the rest of the order. */
function reorder(order: string[], activeId: string, overId: string): string[] {
  if (activeId === overId) return order
  const without = order.filter((id) => id !== activeId)
  const overIndex = without.indexOf(overId)
  if (overIndex === -1) return order
  without.splice(overIndex, 0, activeId)
  return without
}

function RowContent({
  text,
  index,
  state,
}: {
  text: string
  index: number
  state: "idle" | "correct" | "graded"
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-pa-opt border-[1.5px] px-4 py-[15px] text-[15px]",
        state === "correct"
          ? "border-pa-green bg-pa-green-tint text-pa-ink"
          : "border-pa-field-border bg-pa-field text-pa-ink",
      )}
    >
      <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-pa-field-border/40 font-[family-name:var(--font-pa-num)] text-xs font-bold text-pa-muted-2">
        {index + 1}
      </span>
      <span className="flex-1">{text}</span>
      {state === "correct" ? (
        <span aria-hidden className="text-pa-green">
          ✓
        </span>
      ) : null}
    </div>
  )
}

function SequenceRow({
  id,
  text,
  index,
  canAnswer,
  state,
}: {
  id: string
  text: string
  index: number
  canAnswer: boolean
  state: "idle" | "correct" | "graded"
}) {
  const draggable = useDraggable({ id, disabled: !canAnswer })
  const droppable = useDroppable({ id })

  const setRefs = (node: HTMLElement | null) => {
    draggable.setNodeRef(node)
    droppable.setNodeRef(node)
  }

  return (
    <div
      ref={setRefs}
      {...(canAnswer ? draggable.listeners : {})}
      {...(canAnswer ? draggable.attributes : {})}
      className={cn(
        canAnswer ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-default",
        draggable.isDragging && "opacity-30",
        droppable.isOver && "rounded-pa-opt ring-2 ring-pa-green",
      )}
    >
      <RowContent text={text} index={index} state={state} />
    </div>
  )
}

export function PupilSequenceActivity({
  lessonId,
  activityId,
  pupilId,
  canAnswer,
  terms,
  initialCorrectIds,
  initialAttempts,
}: PupilSequenceActivityProps) {
  const [order, setOrder] = useState<string[]>(() => terms.map((term) => term.id))
  const [activeId, setActiveId] = useState<string | null>(null)
  const [correctIds, setCorrectIds] = useState<string[]>(initialCorrectIds)
  const [attempts, setAttempts] = useState<number>(initialAttempts)
  // True once the pupil reorders after a check — hides stale highlights until re-checked.
  const [dirty, setDirty] = useState(false)
  const [isPending, startTransition] = useTransition()
  const { currentVisible } = useFeedbackVisibility()

  const termsById = useMemo(
    () => new Map(terms.map((term) => [term.id, term])),
    [terms],
  )
  const correctIdSet = useMemo(() => new Set(correctIds), [correctIds])

  // Highlighting is only revealed once feedback is released and the checked
  // order is still current.
  const revealed = currentVisible && correctIds.length > 0 && !dirty

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    if (!canAnswer) return
    const { active, over } = event
    if (!over) return
    const next = reorder(order, String(active.id), String(over.id))
    if (next !== order) {
      setOrder(next)
      setDirty(true)
    }
  }

  const handleCheck = () => {
    if (!canAnswer) return
    startTransition(async () => {
      const result = await upsertSequenceSubmissionAction({
        activityId,
        userId: pupilId,
        order,
      })

      if (!result.success) {
        toast.error("Unable to check your answer", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      const parsed = SequenceSubmissionBodySchema.safeParse(result.data?.body)
      if (parsed.success) {
        setCorrectIds(parsed.data.correctIds)
      }
      setAttempts(result.data?.attempt_number ?? attempts + 1)
      setDirty(false)
      triggerFeedbackRefresh(lessonId)
      toast.success("Order checked")
    })
  }

  const activeTerm = activeId ? termsById.get(activeId) ?? null : null

  const rowState = (id: string): "idle" | "correct" | "graded" => {
    if (!revealed) return "idle"
    return correctIdSet.has(id) ? "correct" : "graded"
  }

  return (
    <div className="space-y-3">
      {!canAnswer ? (
        <p className="text-xs text-pa-muted-3">
          You can review this activity, but only pupils can reorder the terms.
        </p>
      ) : (
        <p className="text-xs text-pa-muted-3">
          Drag the terms into the correct order, then press Check.
        </p>
      )}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="space-y-2">
          {order.map((id, index) => {
            const term = termsById.get(id)
            if (!term) return null
            return (
              <SequenceRow
                key={id}
                id={id}
                text={term.text}
                index={index}
                canAnswer={canAnswer}
                state={rowState(id)}
              />
            )
          })}
        </div>

        <DragOverlay>
          {activeTerm ? <RowContent text={activeTerm.text} index={0} state="idle" /> : null}
        </DragOverlay>
      </DndContext>

      {canAnswer ? (
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleCheck}
            disabled={isPending}
            className="rounded-pa-opt bg-pa-green px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
          >
            {isPending ? "Checking…" : "Check"}
          </button>
          {attempts > 0 ? (
            <span className="text-xs text-pa-muted-3">
              {attempts} attempt{attempts === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
