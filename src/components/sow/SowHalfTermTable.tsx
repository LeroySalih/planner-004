'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Plus, X, StickyNote } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  addSowUnitPlacementAction,
  removeSowUnitPlacementAction,
  upsertSowUnitNoteAction,
} from '@/lib/server-updates'
import { HALF_TERM_NAMES } from '@/types'
import type { HalfTerm, HalfTermName, SowHalfTermUnit, SowUnitNote, SowUnitPlacement, Unit } from '@/types'

type Props = {
  groupId: string
  year: number
  /** The class's subject, used to narrow the unit picker. */
  subject: string | null
  halfTerms: HalfTerm[]
  /** Derived from planner_assignments — units whose lessons are timetabled. */
  htUnits: SowHalfTermUnit[]
  initialPlacements: SowUnitPlacement[]
  initialNotes: SowUnitNote[]
  units: Unit[]
}

/**
 * A unit shown in one half-term cell.
 *
 * `timetabled` means its lessons are actually scheduled to this class inside
 * this half-term — that is what green reports. `planned` means a teacher put
 * it here by hand and nothing is scheduled yet. A unit that is both collapses
 * to one timetabled chip: the plan has been realised, so there is nothing to
 * show twice. Its placement row survives, so if the lessons are later
 * unscheduled the chip reverts to planned rather than disappearing.
 */
type Chip = {
  unitId: string
  unitName: string
  source: 'timetabled' | 'planned'
  /** Present only for planned chips — a timetabled chip has nothing to remove. */
  placementId: string | null
  note: string | null
  sortKey: number
}

function formatDateRange(start: string, end: string): string {
  const fmt = (s: string) => {
    const d = new Date(s + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return `${fmt(start)} – ${fmt(end)}`
}

export function SowHalfTermTable({
  groupId,
  year,
  subject,
  halfTerms,
  htUnits,
  initialPlacements,
  initialNotes,
  units,
}: Props) {
  const [placements, setPlacements] = useState(initialPlacements)
  const [notes, setNotes] = useState(initialNotes)
  const [addingIn, setAddingIn] = useState<HalfTermName | null>(null)
  const [search, setSearch] = useState('')
  const [allSubjects, setAllSubjects] = useState(false)
  const [noteTarget, setNoteTarget] = useState<{ halfTerm: HalfTermName; chip: Chip } | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [isPending, startTransition] = useTransition()

  const halfTermMap = useMemo(() => new Map(halfTerms.map((ht) => [ht.name, ht])), [halfTerms])

  // The derived rows carry half_term_id; everything stored here is keyed on the
  // name, so the two have to be reconciled before they can be merged.
  const idToName = useMemo(() => {
    const m = new Map<string, HalfTermName>()
    for (const ht of halfTerms) {
      if ((HALF_TERM_NAMES as readonly string[]).includes(ht.name)) {
        m.set(ht.id, ht.name as HalfTermName)
      }
    }
    return m
  }, [halfTerms])

  const noteFor = (halfTerm: string, unitId: string) =>
    notes.find((n) => n.half_term_name === halfTerm && n.unit_id === unitId)?.note ?? null

  const chipsByHalfTerm = useMemo(() => {
    const out = new Map<HalfTermName, Chip[]>()
    for (const name of HALF_TERM_NAMES) out.set(name, [])

    for (const u of htUnits) {
      const name = idToName.get(u.half_term_id)
      if (!name) continue
      out.get(name)!.push({
        unitId: u.unit_id,
        unitName: u.unit_name ?? u.unit_id,
        source: 'timetabled',
        placementId: null,
        note: noteFor(name, u.unit_id),
        sortKey: u.position,
      })
    }

    for (const p of placements) {
      const list = out.get(p.half_term_name)
      if (!list) continue
      // Already timetabled here: keep the single green chip rather than
      // showing the same unit twice in one cell.
      if (list.some((c) => c.source === 'timetabled' && c.unitId === p.unit_id)) continue
      list.push({
        unitId: p.unit_id,
        unitName: p.unit_name ?? p.unit_id,
        source: 'planned',
        placementId: p.placement_id,
        note: noteFor(p.half_term_name, p.unit_id),
        sortKey: p.position,
      })
    }

    // Timetabled first, in teaching order; planned underneath, in the order added.
    for (const list of out.values()) {
      list.sort((a, b) =>
        a.source === b.source ? a.sortKey - b.sortKey : a.source === 'timetabled' ? -1 : 1,
      )
    }
    return out
  }, [htUnits, placements, notes, idToName])

  const pickerUnits = useMemo(() => {
    const q = search.trim().toLowerCase()
    return units
      .filter((u) => u.active !== false)
      .filter((u) => allSubjects || !subject || u.subject === subject)
      .filter((u) => !q || u.title.toLowerCase().includes(q) || u.unit_id.toLowerCase().includes(q))
      .slice(0, 40)
  }, [units, subject, allSubjects, search])

  function handleAdd(halfTermName: HalfTermName, unit: Unit) {
    const already = chipsByHalfTerm.get(halfTermName)?.some((c) => c.unitId === unit.unit_id)
    if (already) {
      toast.info(`${unit.title} is already in ${halfTermName}`)
      return
    }
    setAddingIn(null)
    setSearch('')
    startTransition(async () => {
      const { error } = await addSowUnitPlacementAction({
        groupId,
        year,
        halfTermName,
        unitId: unit.unit_id,
      })
      if (error) {
        toast.error('Could not add that unit')
        return
      }
      setPlacements((prev) => [
        ...prev,
        {
          placement_id: `pending-${halfTermName}-${unit.unit_id}`,
          group_id: groupId,
          year,
          half_term_name: halfTermName,
          unit_id: unit.unit_id,
          unit_name: unit.title,
          position: prev.filter((p) => p.half_term_name === halfTermName).length,
        },
      ])
      toast.success(`${unit.title} planned into ${halfTermName}`)
    })
  }

  function handleRemove(placementId: string) {
    startTransition(async () => {
      const { error } = await removeSowUnitPlacementAction(placementId)
      if (error) {
        toast.error('Could not remove that unit')
        return
      }
      setPlacements((prev) => prev.filter((p) => p.placement_id !== placementId))
      toast.success('Removed from the plan')
    })
  }

  function handleSaveNote() {
    if (!noteTarget) return
    const { halfTerm, chip } = noteTarget
    const text = noteDraft.trim()
    startTransition(async () => {
      const { error } = await upsertSowUnitNoteAction({
        groupId,
        year,
        halfTermName: halfTerm,
        unitId: chip.unitId,
        note: text,
      })
      if (error) {
        toast.error('Could not save the note')
        return
      }
      setNotes((prev) => {
        const rest = prev.filter(
          (n) => !(n.half_term_name === halfTerm && n.unit_id === chip.unitId),
        )
        return text
          ? [...rest, { group_id: groupId, year, half_term_name: halfTerm, unit_id: chip.unitId, note: text }]
          : rest
      })
      setNoteTarget(null)
      toast.success(text ? 'Note saved' : 'Note cleared')
    })
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
                      // Without dates there is nothing to match timetabled
                      // lessons against, so this column can only ever show
                      // planned units. Say so rather than let it read as a bug.
                      <div
                        className="text-xs font-normal text-[var(--color-text-tertiary)]"
                        title="Set this half-term's dates in Admin → Half Terms for timetabled units to appear here."
                      >
                        Dates not set · planned only
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
                const chips = chipsByHalfTerm.get(name) ?? []
                return (
                  <td
                    key={name}
                    className="border border-[var(--color-border)] bg-[var(--color-background-primary)] px-2 py-2 align-top"
                  >
                    <div className="flex flex-col gap-1.5">
                      {chips.length === 0 ? (
                        <span className="text-xs text-[var(--color-text-tertiary)]">Nothing planned</span>
                      ) : (
                        chips.map((chip) => (
                          <div
                            key={`${chip.source}-${chip.unitId}`}
                            className={`group flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                              chip.source === 'timetabled'
                                ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
                                : 'border-[var(--color-border)] bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setNoteTarget({ halfTerm: name, chip })
                                setNoteDraft(chip.note ?? '')
                              }}
                              className="flex-1 truncate text-left hover:underline"
                              title={chip.note ? chip.note : 'Add a note'}
                            >
                              {chip.unitName}
                            </button>
                            {chip.note ? <StickyNote className="h-3 w-3 shrink-0 opacity-70" /> : null}
                            {/* Only a planned chip can be removed. A timetabled
                                one is a read-out of the timetable — take the
                                lessons out of the plan instead. */}
                            {chip.placementId ? (
                              <button
                                type="button"
                                onClick={() => handleRemove(chip.placementId!)}
                                disabled={isPending}
                                aria-label={`Remove ${chip.unitName} from ${name}`}
                                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-70 hover:opacity-100 focus:opacity-100"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            ) : null}
                          </div>
                        ))
                      )}

                      {addingIn === name ? (
                        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-1.5">
                          <input
                            autoFocus
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search units…"
                            className="mb-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-1.5 py-1 text-xs"
                          />
                          <div className="max-h-44 overflow-y-auto">
                            {pickerUnits.length === 0 ? (
                              <p className="px-1 py-2 text-xs text-[var(--color-text-tertiary)]">
                                No matching units.
                              </p>
                            ) : (
                              pickerUnits.map((u) => (
                                <button
                                  key={u.unit_id}
                                  type="button"
                                  onClick={() => handleAdd(name, u)}
                                  className="block w-full truncate rounded px-1 py-1 text-left text-xs hover:bg-[var(--color-background-primary)]"
                                  title={u.title}
                                >
                                  {u.title}
                                </button>
                              ))
                            )}
                          </div>
                          <label className="mt-1 flex items-center gap-1 px-1 text-[11px] text-[var(--color-text-tertiary)]">
                            <input
                              type="checkbox"
                              checked={allSubjects}
                              onChange={(e) => setAllSubjects(e.target.checked)}
                            />
                            show all subjects
                          </label>
                          <button
                            type="button"
                            onClick={() => { setAddingIn(null); setSearch('') }}
                            className="mt-1 w-full rounded px-1 py-1 text-left text-[11px] text-[var(--color-text-tertiary)] hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setAddingIn(name); setSearch(''); }}
                          className="flex items-center gap-1 rounded-md border border-dashed border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:border-[var(--color-text-secondary)] hover:text-[var(--color-text-secondary)]"
                        >
                          <Plus className="h-3 w-3" />
                          Add unit
                        </button>
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--color-text-tertiary)]">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />
        lessons timetabled to this class
        <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-[var(--color-text-tertiary)] align-middle" />
        planned only. Planning here is for your own organisation — it does not schedule anything.
      </p>

      <Dialog open={noteTarget !== null} onOpenChange={(open) => !open && setNoteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {noteTarget?.chip.unitName} · {noteTarget?.halfTerm}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={6}
            placeholder="Notes for this unit in this half-term…"
          />
          <DialogFooter className="gap-2 sm:justify-between">
            {noteTarget?.chip.unitId ? (
              <Link
                href={`/units/${encodeURIComponent(noteTarget.chip.unitId)}`}
                className="self-center text-xs text-[var(--color-text-tertiary)] hover:underline"
              >
                Open unit
              </Link>
            ) : null}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setNoteTarget(null)} disabled={isPending}>
                Cancel
              </Button>
              <Button onClick={handleSaveNote} disabled={isPending}>
                {isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
