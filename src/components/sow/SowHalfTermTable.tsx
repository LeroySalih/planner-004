'use client'

import { useState } from 'react'
import {
  addSowHalfTermUnitAction,
  removeSowHalfTermUnitAction,
  assignHalfTermUnitsToGroupsAction,
} from '@/lib/server-updates'
import { toast } from 'sonner'
import type { HalfTerm, SowHalfTermUnit, TeacherGroup, Unit } from '@/types'
import { Button } from '@/components/ui/button'

const HALF_TERM_NAMES = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] as const

type Props = {
  groupId: string
  year: number
  halfTerms: HalfTerm[]
  htUnits: SowHalfTermUnit[]
  units: Unit[]
  allGroups: TeacherGroup[]
}

function formatDateRange(start: string, end: string): string {
  const fmt = (s: string) => {
    const d = new Date(s + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return `${fmt(start)} – ${fmt(end)}`
}

export function SowHalfTermTable({ groupId, year, halfTerms, htUnits, units, allGroups }: Props) {
  const [localHtUnits, setLocalHtUnits] = useState<SowHalfTermUnit[]>(htUnits)
  const [adding, setAdding] = useState<string | null>(null)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)
  const [showAssign, setShowAssign] = useState(false)

  const halfTermMap = new Map(halfTerms.map((ht) => [ht.name, ht]))

  async function handleAdd(halfTermId: string, unitId: string) {
    const { error } = await addSowHalfTermUnitAction(groupId, halfTermId, unitId)
    if (error) { toast.error('Failed to add unit'); return }
    const unit = units.find((u) => u.unit_id === unitId)
    setLocalHtUnits((prev) => [
      ...prev,
      {
        group_id: groupId,
        half_term_id: halfTermId,
        unit_id: unitId,
        unit_name: unit?.title,
        position: prev.filter((u) => u.half_term_id === halfTermId).length,
      },
    ])
    setAdding(null)
  }

  async function handleRemove(halfTermId: string, unitId: string) {
    const { error } = await removeSowHalfTermUnitAction(groupId, halfTermId, unitId)
    if (error) { toast.error('Failed to remove unit'); return }
    setLocalHtUnits((prev) =>
      prev.filter((u) => !(u.half_term_id === halfTermId && u.unit_id === unitId)),
    )
  }

  function toggleGroup(groupId: string) {
    setSelectedGroups((prev) => {
      const next = new Set(prev)
      next.has(groupId) ? next.delete(groupId) : next.add(groupId)
      return next
    })
  }

  async function handleAssign() {
    if (selectedGroups.size === 0) { toast.error('Select at least one class'); return }
    setAssigning(true)
    const { error } = await assignHalfTermUnitsToGroupsAction(groupId, [...selectedGroups], year)
    setAssigning(false)
    if (error) { toast.error('Failed to assign'); return }
    toast.success(`Assigned to ${selectedGroups.size} class${selectedGroups.size > 1 ? 'es' : ''}`)
    setShowAssign(false)
    setSelectedGroups(new Set())
  }

  return (
    <div className="mb-8 space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {HALF_TERM_NAMES.map((name) => {
                const ht = halfTermMap.get(name)
                return (
                  <th
                    key={name}
                    className="border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-3 py-2 text-left font-semibold text-[var(--color-text-primary)] w-[16.66%]"
                  >
                    <div>{name}</div>
                    {ht ? (
                      <div className="text-xs font-normal text-[var(--color-text-secondary)]">
                        {formatDateRange(ht.start_date, ht.end_date)}
                      </div>
                    ) : (
                      <div className="text-xs font-normal text-[var(--color-text-tertiary)]">
                        Not configured
                      </div>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              {HALF_TERM_NAMES.map((name) => {
                const ht = halfTermMap.get(name)
                const cellUnits = ht
                  ? localHtUnits
                      .filter((u) => u.half_term_id === ht.id)
                      .sort((a, b) => a.position - b.position)
                  : []
                const usedUnitIds = new Set(cellUnits.map((u) => u.unit_id))

                return (
                  <td
                    key={name}
                    className="border border-[var(--color-border)] bg-[var(--color-background-primary)] px-3 py-2 align-top"
                  >
                    <div className="flex flex-col gap-1">
                      {cellUnits.map((cu) => (
                        <span
                          key={cu.unit_id}
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-xs"
                        >
                          {cu.unit_name ?? cu.unit_id}
                          {ht && (
                            <button
                              onClick={() => handleRemove(ht.id, cu.unit_id)}
                              className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] ml-0.5"
                              aria-label={`Remove ${cu.unit_name ?? cu.unit_id}`}
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                      {ht && adding === ht.id ? (
                        <select
                          autoFocus
                          className="text-xs rounded border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-1 py-0.5 mt-1"
                          defaultValue=""
                          onChange={(e) => e.target.value && handleAdd(ht.id, e.target.value)}
                          onBlur={() => setAdding(null)}
                        >
                          <option value="" disabled>Select unit…</option>
                          {units
                            .filter((u) => !usedUnitIds.has(u.unit_id))
                            .map((u) => (
                              <option key={u.unit_id} value={u.unit_id}>
                                {u.title}
                              </option>
                            ))}
                        </select>
                      ) : ht ? (
                        <button
                          onClick={() => setAdding(ht.id)}
                          className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-left mt-0.5"
                        >
                          + Add unit
                        </button>
                      ) : null}
                    </div>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Assign to other classes */}
      {allGroups.length > 0 && (
        <div className="flex items-start gap-2">
          {showAssign ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {allGroups.map((g) => (
                  <button
                    key={g.group_id}
                    onClick={() => toggleGroup(g.group_id)}
                    className={`rounded px-2.5 py-1 text-xs border transition-colors ${
                      selectedGroups.has(g.group_id)
                        ? 'bg-[var(--color-text-primary)] text-[var(--color-background-primary)] border-[var(--color-text-primary)]'
                        : 'bg-[var(--color-background-secondary)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-secondary)]'
                    }`}
                  >
                    {g.group_id}
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={handleAssign} disabled={assigning || selectedGroups.size === 0}>
                {assigning ? 'Assigning…' : `Assign${selectedGroups.size > 0 ? ` (${selectedGroups.size})` : ''}`}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowAssign(false); setSelectedGroups(new Set()) }}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowAssign(true)}>
              Assign to…
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
