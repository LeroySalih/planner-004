'use client'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * Class-column filtering, shared by the unit and LO progress matrices.
 *
 * Both reports put classes on the x axis and both accumulate retired classes
 * there — the DT tab alone carries a full year of them. Active-only is the
 * default view; the switch is there because last year's results still need
 * looking at.
 */
export function matchesClassFilter(classId: string, filter: string): boolean {
  const needle = filter.trim().toLowerCase()
  if (!needle) return true
  return classId.toLowerCase().includes(needle)
}

type ClassFilterControlsProps = {
  /** Unique across the page, so labels bind to the right control. */
  idPrefix: string
  classFilter: string
  onClassFilterChange: (value: string) => void
  showInactive: boolean
  onShowInactiveChange: (value: boolean) => void
  /** Inactive classes in the current subject, so the switch can say what it hides. */
  inactiveCount: number
}

export function ClassFilterControls({
  idPrefix,
  classFilter,
  onClassFilterChange,
  showInactive,
  onShowInactiveChange,
  inactiveCount,
}: ClassFilterControlsProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Label
          htmlFor={`${idPrefix}-class-filter`}
          className="text-sm font-medium text-muted-foreground whitespace-nowrap"
        >
          Class
        </Label>
        <input
          id={`${idPrefix}-class-filter`}
          type="search"
          value={classFilter}
          onChange={(event) => onClassFilterChange(event.target.value)}
          placeholder="e.g. 26-10-DT"
          className="w-40 rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs"
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={`${idPrefix}-inactive-toggle`}
          checked={showInactive}
          onCheckedChange={onShowInactiveChange}
        />
        <Label
          htmlFor={`${idPrefix}-inactive-toggle`}
          className="cursor-pointer text-sm font-medium text-muted-foreground whitespace-nowrap"
        >
          Show inactive classes
          {inactiveCount > 0 ? ` (${inactiveCount})` : ''}
        </Label>
      </div>
    </>
  )
}
