"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
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

import { upsertGroupItemsSubmissionAction } from "@/lib/server-updates"
import { cn } from "@/lib/utils"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"

interface GroupItemsGroupOption {
  id: string
  name: string
}

interface GroupItemsItemOption {
  id: string
  text: string
  imageUrl: string | null
}

interface PupilGroupItemsActivityProps {
  lessonId: string
  activityId: string
  title: string | null
  pupilId: string
  canAnswer: boolean
  groups: GroupItemsGroupOption[]
  items: GroupItemsItemOption[]
  initialItemOrder: string[]
  initialPlacements: Record<string, string | null>
}

const BANK_ID = "bank"

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function ItemChipContent({ item }: { item: GroupItemsItemOption }) {
  return (
    <div className="flex items-center gap-2 rounded-pa-opt border-[1.5px] border-pa-field-border bg-pa-field px-4 py-[15px] text-[15px] text-pa-ink">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" className="h-12 w-12 rounded object-cover" />
      ) : null}
      <span>{item.text}</span>
    </div>
  )
}

function ItemChip({
  item,
  canAnswer,
}: {
  item: GroupItemsItemOption
  canAnswer: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    disabled: !canAnswer,
  })

  return (
    <div
      ref={setNodeRef}
      {...(canAnswer ? listeners : {})}
      {...(canAnswer ? attributes : {})}
      className={cn(
        canAnswer ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-default",
        isDragging && "opacity-30",
      )}
    >
      <ItemChipContent item={item} />
    </div>
  )
}

function DropZone({
  id,
  label,
  itemIds,
  itemsById,
  canAnswer,
}: {
  id: string
  label: string
  itemIds: string[]
  itemsById: Map<string, GroupItemsItemOption>
  canAnswer: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[100px] flex-1 space-y-2 rounded-pa-box border-2 border-dashed border-pa-field-border bg-pa-field p-4",
        isOver && "border-pa-green bg-pa-green-tint",
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-pa-muted-3">{label}</p>
      <div className="flex flex-wrap gap-2">
        {itemIds.map((itemId) => {
          const item = itemsById.get(itemId)
          if (!item) return null
          return <ItemChip key={itemId} item={item} canAnswer={canAnswer} />
        })}
      </div>
    </div>
  )
}

export function PupilGroupItemsActivity({
  lessonId,
  activityId,
  title,
  pupilId,
  canAnswer,
  groups,
  items,
  initialItemOrder,
  initialPlacements,
}: PupilGroupItemsActivityProps) {
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const itemIds = useMemo(() => items.map((item) => item.id), [items])

  const itemOrder = useMemo(() => {
    const hasValidOrder =
      initialItemOrder.length === itemIds.length &&
      itemIds.every((id) => initialItemOrder.includes(id))
    return hasValidOrder ? initialItemOrder : shuffle(itemIds)
  }, [initialItemOrder, itemIds])

  const [placements, setPlacements] = useState<Record<string, string | null>>(() => {
    const next: Record<string, string | null> = {}
    itemIds.forEach((id) => {
      next[id] = initialPlacements[id] ?? null
    })
    return next
  })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [hasSaved, setHasSaved] = useState(false)

  useEffect(() => {
    const next: Record<string, string | null> = {}
    itemIds.forEach((id) => {
      next[id] = initialPlacements[id] ?? null
    })
    setPlacements(next)
  }, [activityId, initialPlacements, itemIds])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const groupIds = useMemo(() => new Set(groups.map((group) => group.id)), [groups])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null)
      if (!canAnswer) return

      const { active, over } = event
      if (!over) return

      const itemId = String(active.id)
      const targetId = String(over.id)
      const nextGroupId = targetId !== BANK_ID && groupIds.has(targetId) ? targetId : null

      if (placements[itemId] === nextGroupId) return

      const nextPlacements = { ...placements, [itemId]: nextGroupId }
      setPlacements(nextPlacements)

      startTransition(async () => {
        const result = await upsertGroupItemsSubmissionAction({
          activityId,
          userId: pupilId,
          itemOrder,
          placements: nextPlacements,
        })

        if (!result.success) {
          toast.error("Unable to save your answer", {
            description: result.error ?? "Please try again later.",
          })
          return
        }

        setHasSaved(true)
        triggerFeedbackRefresh(lessonId)
      })
    },
    [activityId, canAnswer, groupIds, itemOrder, lessonId, placements, pupilId],
  )

  const bankItemIds = itemOrder.filter((id) => !placements[id])
  const activeItem = activeId ? itemsById.get(activeId) ?? null : null

  return (
    <div className="space-y-3">
      {!canAnswer ? (
        <p className="text-xs text-pa-muted-3">
          You can review this activity, but only pupils can move items.
        </p>
      ) : null}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex flex-col gap-3 sm:flex-row">
          {groups.map((group) => (
            <DropZone
              key={group.id}
              id={group.id}
              label={group.name}
              itemIds={itemOrder.filter((id) => placements[id] === group.id)}
              itemsById={itemsById}
              canAnswer={canAnswer}
            />
          ))}
        </div>

        <DropZone
          id={BANK_ID}
          label="Item bank"
          itemIds={bankItemIds}
          itemsById={itemsById}
          canAnswer={canAnswer}
        />

        <DragOverlay>
          {activeItem ? <ItemChipContent item={activeItem} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
