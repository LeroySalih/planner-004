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
import { RichInline } from "@/components/lessons/activity-view/rich-inline"
import { cn } from "@/lib/utils"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"
import { seededRandom, seededShuffle } from "@/lib/seeded-shuffle"

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

function ItemChipContent({ item }: { item: GroupItemsItemOption }) {
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-full border border-pa-field-border bg-pa-panel px-4 py-2 text-[15px] text-pa-ink shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
      ) : null}
      <span><RichInline text={item.text} /></span>
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
  variant = "group",
}: {
  id: string
  label: string
  itemIds: string[]
  itemsById: Map<string, GroupItemsItemOption>
  canAnswer: boolean
  variant?: "group" | "bank"
}) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "space-y-2 rounded-[10px] p-4",
        variant === "group"
          ? "min-h-[120px] border-2 border-dashed border-pa-field-border bg-pa-panel"
          : "min-h-[72px] border border-pa-card-border bg-pa-green-tint/40",
        isOver && "border-pa-green bg-pa-green-tint",
      )}
    >
      <div className="text-sm font-semibold text-pa-muted-2"><RichInline text={label} /></div>
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
    return hasValidOrder ? initialItemOrder : seededShuffle(itemIds, seededRandom(`${activityId}:${pupilId}`))
  }, [initialItemOrder, itemIds, activityId, pupilId])

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
        triggerFeedbackRefresh(lessonId, activityId)
      })
    },
    [activityId, canAnswer, groupIds, itemOrder, lessonId, placements, pupilId],
  )

  const bankItemIds = itemOrder.filter((id) => !placements[id])
  const activeItem = activeId ? itemsById.get(activeId) ?? null : null

  return (
    <div className="space-y-3">
      {!canAnswer ? (
        <p className="text-sm text-pa-muted-3">
          You can review this activity, but only pupils can move items.
        </p>
      ) : null}

      {/* A stable id keeps dnd-kit's aria ids the same on the server and the client. */}
      <DndContext id={`group-items-${activityId}`} sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <DropZone
          id={BANK_ID}
          label={bankItemIds.length > 0 ? "Drag each item into a group" : "All items sorted. Drag one back here to move it."}
          itemIds={bankItemIds}
          itemsById={itemsById}
          canAnswer={canAnswer}
          variant="bank"
        />

        <div className={cn("grid gap-3", groups.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
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

        <DragOverlay>
          {activeItem ? <ItemChipContent item={activeItem} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
