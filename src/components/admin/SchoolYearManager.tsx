'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { upsertSchoolYearAction, setSchoolYearActiveAction } from '@/lib/server-updates'
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
    setYears((prev) => [{ year: y, label, active: true }, ...prev].sort((a, b) => b.year - a.year))
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
    setYears((prev) => prev.map((y) => y.year === year ? { ...y, active: !currentActive } : y))
    toast.success(!currentActive ? 'Year activated' : 'Year deactivated')
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
