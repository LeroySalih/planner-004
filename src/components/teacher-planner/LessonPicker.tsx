'use client'

import { useState } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { CheckIcon } from 'lucide-react'
import { Select, SelectContent, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { loadPlannerUnitOverview, type PlannerUnitOverviewData } from './unit-overview-cache'

type PickerLesson = { lessonId: string; title: string }

type PickerItem = PickerLesson & {
  /** Undefined until the unit's dates have loaded: shown plain, never red. */
  latestDate?: string | null
  occurrences?: number
}

type PickerGroup = { key: string; title: string | null; items: PickerItem[] }

type LessonPickerProps = {
  unitId: string
  groupId: string
  /** The lessons on offer, in unit order. */
  lessons: PickerLesson[]
  /** The chosen lesson, or '' for none. */
  value: string
  onSelect: (lessonId: string) => void
  /** Called as the picker is about to be used, so the cell can load the unit's lessons. */
  onPrefetch?: () => void
  disabled?: boolean
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The lessons on offer, grouped by sub unit and dated from the unit overview.
 * A lesson the overview does not list goes under "Other lessons", so nothing
 * on offer is ever hidden by it.
 */
function buildGroups(lessons: PickerLesson[], overview: PlannerUnitOverviewData | null): PickerGroup[] {
  if (!overview) return [{ key: 'all', title: null, items: lessons }]
  const offered = new Map(lessons.map((l) => [l.lessonId, l]))
  const placed = new Set<string>()
  const groups: PickerGroup[] = overview.groups.map((group) => ({
    key: group.subUnitId ?? 'other',
    title: group.title,
    items: group.lessons.flatMap((lesson) => {
      const own = offered.get(lesson.lessonId)
      if (!own) return []
      placed.add(lesson.lessonId)
      return [{ ...own, latestDate: lesson.latestDate, occurrences: lesson.occurrences }]
    }),
  }))
  // Undated rather than red: the overview cannot say whether these are planned.
  const leftover = lessons.filter((l) => !placed.has(l.lessonId))
  if (leftover.length > 0) {
    const other = groups.find((g) => g.key === 'other')
    if (other) other.items.push(...leftover)
    else groups.push({ key: 'other', title: groups.some((g) => g.title) ? 'Other lessons' : null, items: leftover })
  }
  return groups.filter((g) => g.items.length > 0)
}

/**
 * A cell's lesson picker. Each lesson shows the latest date it is planned
 * for this class, and is red when it is not planned for it at all. The dates
 * load on first hover, focus or open; until then the list is plain.
 */
export function LessonPicker({ unitId, groupId, lessons, value, onSelect, onPrefetch, disabled }: LessonPickerProps) {
  // Tagged with its class and unit, so a cell that changed either never shows
  // the previous pair's dates while the new ones load.
  const [overview, setOverview] = useState<{ groupId: string; data: PlannerUnitOverviewData } | null>(null)

  // Always asks the cache, which is emptied when the plan changes, so an
  // open after a change re-reads the dates.
  const load = () => {
    onPrefetch?.()
    void loadPlannerUnitOverview(groupId, unitId).then((result) => {
      if (result.data) setOverview({ groupId, data: result.data })
    })
  }

  const shown = overview && overview.groupId === groupId && overview.data.unitId === unitId ? overview.data : null
  const groups = buildGroups(lessons, shown)
  const today = todayIso()
  const selectedTitle = lessons.find((l) => l.lessonId === value)?.title

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) onSelect(next)
      }}
      onOpenChange={(open) => {
        if (open) load()
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className="w-full gap-1 [&_svg]:size-3 data-[size=sm]:h-auto rounded border-[var(--color-border)] bg-[var(--color-background-primary)] dark:bg-[var(--color-background-primary)] dark:hover:bg-[var(--color-background-primary)] px-1 py-0.5 text-left text-xs shadow-none disabled:cursor-default disabled:opacity-60"
        onPointerEnter={() => {
          if (!disabled) load()
        }}
        onFocus={load}
      >
        {/* The title only: the date belongs in the list, not the cell. */}
        <SelectValue placeholder="Lesson…" className="min-w-0">
          <span className="truncate">{selectedTitle}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        className="w-[300px] min-w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-content-available-width)] max-h-[min(360px,var(--radix-select-content-available-height))] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border-[var(--color-border)]"
      >
        {groups.map((group) => (
          <SelectGroup key={group.key} className="flex flex-col pb-1 last:pb-0">
            {group.title && (
              <SelectLabel className="px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
                {group.title}
              </SelectLabel>
            )}
            {group.items.map((lesson, index) => {
              const unplanned = lesson.latestDate === null
              return (
                <SelectPrimitive.Item
                  key={lesson.lessonId}
                  value={lesson.lessonId}
                  className={cn(
                    'relative flex w-full cursor-default select-none items-baseline justify-between gap-2 rounded py-0.5 pl-1.5 pr-6 text-xs outline-hidden focus:bg-accent data-[state=checked]:font-semibold',
                    index % 2 === 1 && 'bg-[var(--color-background-secondary)]',
                  )}
                >
                  {/* Red: not yet planned for this class. */}
                  <SelectPrimitive.ItemText asChild>
                    <span className={cn('min-w-0', unplanned && 'text-[#A32D2D]')}>{lesson.title}</span>
                  </SelectPrimitive.ItemText>
                  {lesson.latestDate && (
                    <span
                      className={cn(
                        'shrink-0 tabular-nums font-normal',
                        lesson.latestDate < today
                          ? 'text-[var(--color-text-tertiary)]'
                          : 'text-[var(--color-text-secondary)]',
                      )}
                      title={
                        lesson.occurrences && lesson.occurrences > 1
                          ? `Planned ${lesson.occurrences} times; the latest is shown`
                          : undefined
                      }
                    >
                      {formatDate(lesson.latestDate)}
                      {lesson.occurrences && lesson.occurrences > 1 ? ` +${lesson.occurrences - 1}` : null}
                    </span>
                  )}
                  <span className="absolute right-1.5 flex size-3 items-center justify-center self-center">
                    <SelectPrimitive.ItemIndicator>
                      <CheckIcon className="size-3" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                </SelectPrimitive.Item>
              )
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
