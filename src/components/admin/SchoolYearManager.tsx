'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  setCurrentSchoolYearAction,
  setSchoolYearActiveAction,
  upsertSchoolYearAction,
} from '@/lib/server-updates'
import type { SchoolYear } from '@/types'
import { Button } from '@/components/ui/button'

type Props = {
  initialYears: SchoolYear[]
}

function defaultLabel(year: number) {
  return `${year}/${String(year + 1).slice(2)}`
}

export function SchoolYearManager({ initialYears }: Props) {
  const [years, setYears] = useState<SchoolYear[]>(initialYears)
  const [newYear, setNewYear] = useState('')
  const [editingYear, setEditingYear] = useState<number | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    const y = parseInt(newYear, 10)
    if (!y || y < 2000 || y > 2100) { toast.error('Enter a valid start year (e.g. 2025)'); return }
    if (years.find((yr) => yr.year === y)) { toast.error('Year already exists'); return }
    setSaving(true)
    const label = defaultLabel(y)
    const { error } = await upsertSchoolYearAction(y, label)
    setSaving(false)
    if (error) { toast.error('Failed to add year'); return }
    setYears((prev) => [{ year: y, label, active: true, is_current: false }, ...prev].sort((a, b) => b.year - a.year))
    setNewYear('')
    toast.success(`Added ${label}`)
  }

  async function handleSaveLabel(year: number) {
    setSaving(true)
    const { error } = await upsertSchoolYearAction(year, editLabel)
    setSaving(false)
    if (error) { toast.error('Failed to update label'); return }
    setYears((prev) => prev.map((y) => y.year === year ? { ...y, label: editLabel } : y))
    setEditingYear(null)
    toast.success('Label updated')
  }

  async function handleToggleActive(year: number, currentActive: boolean) {
    const { error } = await setSchoolYearActiveAction(year, !currentActive)
    if (error) { toast.error('Failed to update'); return }
    // Deactivating also clears "current" server-side — mirror that here so the
    // badge does not linger on a year the app no longer defaults to.
    setYears((prev) =>
      prev.map((y) =>
        y.year === year
          ? { ...y, active: !currentActive, is_current: currentActive ? false : y.is_current }
          : y,
      ),
    )
    toast.success(!currentActive ? 'Year activated' : 'Year deactivated')
  }

  async function handleSetCurrent(year: number) {
    setSaving(true)
    const { error } = await setCurrentSchoolYearAction(year)
    setSaving(false)
    if (error) { toast.error(error); return }
    setYears((prev) => prev.map((y) => ({ ...y, is_current: y.year === year })))
    toast.success(`${years.find((y) => y.year === year)?.label ?? year} is now the current year`)
  }

  return (
    <div className="space-y-6">
      {/* Add new year */}
      <div className="flex items-center gap-2">
        <input
          type="number"
          placeholder="Start year e.g. 2026"
          value={newYear}
          onChange={(e) => setNewYear(e.target.value)}
          className="w-52 rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
        />
        <Button size="sm" onClick={handleAdd} disabled={saving || !newYear}>
          Add year
        </Button>
      </div>

      {/* Year list */}
      <div className="rounded-md border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
        {years.length === 0 && (
          <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">No school years configured.</p>
        )}
        {years.map((y) => (
          <div key={y.year} className="flex items-center justify-between px-4 py-3 gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {editingYear === y.year ? (
                <input
                  autoFocus
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-2 py-1 text-sm text-[var(--color-text-primary)] w-36"
                />
              ) : (
                <span className={`text-sm font-medium ${y.active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] line-through'}`}>
                  {y.label}
                </span>
              )}
              <span className="text-xs text-[var(--color-text-tertiary)]">({y.year})</span>
              {y.is_current && (
                <span className="rounded-full bg-primary/10 border border-primary/30 px-2 py-0.5 text-xs font-semibold text-primary">
                  current
                </span>
              )}
              {!y.active && (
                <span className="text-xs rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-tertiary)]">
                  inactive
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {editingYear === y.year ? (
                <>
                  <Button size="sm" onClick={() => handleSaveLabel(y.year)} disabled={saving}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingYear(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setEditingYear(y.year); setEditLabel(y.label) }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving || y.is_current || !y.active}
                    title={
                      !y.active
                        ? 'Activate this year before making it current'
                        : y.is_current
                          ? 'Already the current year'
                          : 'Use this year as the default across the app'
                    }
                    onClick={() => handleSetCurrent(y.year)}
                  >
                    {y.is_current ? 'Current' : 'Set current'}
                  </Button>
                  <Button
                    size="sm"
                    variant={y.active ? 'ghost' : 'outline'}
                    onClick={() => handleToggleActive(y.year, y.active)}
                  >
                    {y.active ? 'Deactivate' : 'Activate'}
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
