'use client'

import { useMemo, useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  addSharedSowUnitAction,
  readHalfTermsAction,
  readSharedSowDetailAction,
  readSharedSowUnitsAction,
  removeSharedSowUnitAction,
} from '@/lib/server-updates'
import { HALF_TERM_NAMES } from '@/types'
import type { HalfTerm, HalfTermName, SharedSowUnit, Unit } from '@/types'

type Scope = { subject: string; yearGroup: number; classCount: number }

/** One planned unit written out in full, for the table under the grid. */
type DetailRow = {
  half_term_name: HalfTermName
  position: number
  unit_id: string
  unit_name: string
  description: string | null
  objectives: string[]
}

type Props = {
  /** Subject and year-group pairs that have active classes. */
  scopes: Scope[]
  years: number[]
  initialYear: number
  initialHalfTerms: HalfTerm[]
  initialSharedUnits: SharedSowUnit[]
  initialDetail: DetailRow[]
  units: Unit[]
}

function formatDateRange(start: string, end: string): string {
  const fmt = (s: string) => {
    const d = new Date(s + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return `${fmt(start)} – ${fmt(end)}`
}

/**
 * The department's plan: which units a subject teaches in each half term, for
 * one year group. Laid out like the class scheme-of-work table so the two read
 * the same way, but every unit here reaches every class in the subject and
 * year, which is why the page says so and the remove confirms.
 */
export function SharedSowAdmin({
  scopes,
  years,
  initialYear,
  initialHalfTerms,
  initialSharedUnits,
  initialDetail,
  units,
}: Props) {
  const [year, setYear] = useState(initialYear)
  const [scopeKey, setScopeKey] = useState(
    scopes[0] ? `${scopes[0].subject}|${scopes[0].yearGroup}` : '',
  )
  const [halfTerms, setHalfTerms] = useState(initialHalfTerms)
  const [sharedUnits, setSharedUnits] = useState(initialSharedUnits)
  const [detail, setDetail] = useState(initialDetail)
  const [addingIn, setAddingIn] = useState<HalfTermName | null>(null)
  const [unitFilter, setUnitFilter] = useState('')
  const [isPending, startTransition] = useTransition()

  const scope = useMemo(() => {
    const [subject, yearGroup] = scopeKey.split('|')
    return subject ? { subject, yearGroup: Number(yearGroup) } : null
  }, [scopeKey])

  const halfTermByName = useMemo(() => {
    const out = new Map<HalfTermName, HalfTerm>()
    for (const ht of halfTerms) out.set(ht.name, ht)
    return out
  }, [halfTerms])

  const unitsByHalfTerm = useMemo(() => {
    const out = new Map<HalfTermName, SharedSowUnit[]>()
    for (const name of HALF_TERM_NAMES) out.set(name, [])
    for (const su of sharedUnits) out.get(su.half_term_name)?.push(su)
    for (const list of out.values()) list.sort((a, b) => a.position - b.position)
    return out
  }, [sharedUnits])

  // Units of this subject, with the year group's own units first: a Year 8
  // plan almost always wants Year 8 units, but nothing stops a department
  // reaching for another year's.
  const pickableUnits = useMemo(() => {
    if (!scope) return []
    const q = unitFilter.trim().toLowerCase()
    return units
      .filter((u) => u.subject === scope.subject)
      .filter((u) => (q ? u.title.toLowerCase().includes(q) || u.unit_id.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        const aMatch = a.year === scope.yearGroup ? 0 : 1
        const bMatch = b.year === scope.yearGroup ? 0 : 1
        if (aMatch !== bMatch) return aMatch - bMatch
        return a.title.localeCompare(b.title)
      })
  }, [units, scope, unitFilter])

  async function reload(nextYear: number, nextScopeKey: string) {
    const [subject, yearGroupRaw] = nextScopeKey.split('|')
    if (!subject) return
    const yearGroup = Number(yearGroupRaw)
    const [htResult, suResult, detailResult] = await Promise.all([
      readHalfTermsAction(nextYear),
      readSharedSowUnitsAction({ academicYear: nextYear, subject, yearGroup }),
      readSharedSowDetailAction({ academicYear: nextYear, subject, yearGroup }),
    ])
    setHalfTerms(htResult.data ?? [])
    setSharedUnits(suResult.data ?? [])
    setDetail((detailResult.data ?? []) as DetailRow[])
  }

  function handleYearChange(nextYear: number) {
    setYear(nextYear)
    startTransition(async () => {
      await reload(nextYear, scopeKey)
    })
  }

  function handleScopeChange(nextScopeKey: string) {
    setScopeKey(nextScopeKey)
    startTransition(async () => {
      await reload(year, nextScopeKey)
    })
  }

  function handleAdd(halfTermName: HalfTermName, unitId: string) {
    if (!scope) return
    setAddingIn(null)
    setUnitFilter('')
    startTransition(async () => {
      const { data, error } = await addSharedSowUnitAction({
        academicYear: year,
        subject: scope.subject,
        yearGroup: scope.yearGroup,
        halfTermName,
        unitId,
      })
      if (error || !data) {
        toast.error(error ?? 'Could not add that unit.')
        return
      }
      await reload(year, scopeKey)
    })
  }

  function handleRemove(su: SharedSowUnit) {
    if (!scope) return
    const classes = scopes.find(
      (s) => s.subject === scope.subject && s.yearGroup === scope.yearGroup,
    )?.classCount ?? 0
    const confirmed = window.confirm(
      `Remove ${su.unit_name ?? su.unit_id} from ${su.half_term_name}? ` +
        `It will disappear from the scheme of work of ${classes} class${classes === 1 ? '' : 'es'}.`,
    )
    if (!confirmed) return
    startTransition(async () => {
      const { error } = await removeSharedSowUnitAction(su.shared_unit_id)
      if (error) {
        toast.error(error)
        return
      }
      setSharedUnits((prev) => prev.filter((s) => s.shared_unit_id !== su.shared_unit_id))
      await reload(year, scopeKey)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Subject and year</span>
          <select
            value={scopeKey}
            onChange={(e) => handleScopeChange(e.target.value)}
            disabled={isPending}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs"
          >
            {scopes.map((s) => (
              <option key={`${s.subject}|${s.yearGroup}`} value={`${s.subject}|${s.yearGroup}`}>
                {s.subject} · Year {s.yearGroup} ({s.classCount} class{s.classCount === 1 ? '' : 'es'})
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Academic year</span>
          <select
            value={year}
            onChange={(e) => handleYearChange(Number(e.target.value))}
            disabled={isPending}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}/{String(y + 1).slice(2)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {HALF_TERM_NAMES.map((name) => {
                const ht = halfTermByName.get(name)
                return (
                  <th key={name} className="w-1/6 px-3 py-2 text-left align-top">
                    <div className="text-sm font-semibold text-foreground">{name}</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {ht ? formatDateRange(ht.start_date, ht.end_date) : 'Dates not set'}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              {HALF_TERM_NAMES.map((name) => (
                <td key={name} className="border-t border-border px-3 py-3 align-top">
                  <div className="space-y-1.5">
                    {(unitsByHalfTerm.get(name) ?? []).map((su) => (
                      <div
                        key={su.shared_unit_id}
                        className="group flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                      >
                        <span className="flex-1 truncate" title={su.unit_name ?? su.unit_id}>
                          {su.unit_name ?? su.unit_id}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemove(su)}
                          disabled={isPending}
                          aria-label={`Remove ${su.unit_name ?? su.unit_id} from ${name}`}
                          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-70 hover:opacity-100 focus:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}

                    {addingIn === name ? (
                      <div className="rounded-md border border-border bg-background p-1.5">
                        <input
                          type="search"
                          autoFocus
                          value={unitFilter}
                          onChange={(e) => setUnitFilter(e.target.value)}
                          placeholder="Find a unit"
                          className="mb-1.5 w-full rounded border border-input bg-background px-2 py-1 text-xs"
                        />
                        <div className="max-h-48 space-y-0.5 overflow-y-auto">
                          {pickableUnits.length === 0 ? (
                            <p className="px-1 py-2 text-xs text-muted-foreground">
                              No units match.
                            </p>
                          ) : (
                            pickableUnits.map((u) => (
                              <button
                                key={u.unit_id}
                                type="button"
                                onClick={() => handleAdd(name, u.unit_id)}
                                className="block w-full truncate rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
                                title={u.title}
                              >
                                {u.title}
                                {u.year != null && scope && u.year !== scope.yearGroup ? (
                                  <span className="ml-1 text-muted-foreground">(Y{u.year})</span>
                                ) : null}
                              </button>
                            ))
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => { setAddingIn(null); setUnitFilter('') }}
                          className="mt-1 w-full rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        onClick={() => { setAddingIn(name); setUnitFilter('') }}
                        className="h-7 w-full justify-start px-2 text-xs text-muted-foreground"
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Add unit
                      </Button>
                    )}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Changes here reach every class in the chosen subject and year group straight away.
      </p>

      {/* The same plan written out in full. Both come from the one reload, so
          the table cannot drift from the grid above it. */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left">
              <th className="w-20 px-3 py-2 font-semibold text-foreground">Half term</th>
              <th className="w-1/5 px-3 py-2 font-semibold text-foreground">Unit</th>
              <th className="px-3 py-2 font-semibold text-foreground">Description</th>
              <th className="w-2/5 px-3 py-2 font-semibold text-foreground">Learning objectives</th>
            </tr>
          </thead>
          <tbody>
            {detail.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing planned yet. Add a unit above and it appears here.
                </td>
              </tr>
            ) : (
              detail.map((row, index) => {
                // Only label the half term on its first row, so the eye groups
                // the units that share one.
                const firstOfHalfTerm =
                  index === 0 || detail[index - 1].half_term_name !== row.half_term_name
                return (
                  <tr
                    key={`${row.half_term_name}|${row.unit_id}`}
                    className={`border-b border-border last:border-b-0 align-top ${
                      firstOfHalfTerm ? '' : 'border-t-0'
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-foreground">
                      {firstOfHalfTerm ? row.half_term_name : ''}
                    </td>
                    <td className="px-3 py-2 text-foreground">{row.unit_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.description?.trim()
                        ? row.description
                        : <span className="italic">No description</span>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.objectives.length === 0 ? (
                        <span className="italic">None linked</span>
                      ) : (
                        <ul className="list-disc space-y-0.5 pl-4">
                          {row.objectives.map((objective) => (
                            <li key={objective}>{objective}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
