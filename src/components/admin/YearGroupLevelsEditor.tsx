'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getLevelBoundaries, MAX_LEVEL, MIN_LEVEL, type YearGroupLevels } from '@/lib/levels'
import { saveYearGroupLevelsAction } from '@/lib/server-updates'

type Row = { key: number; yearGroup: string; minLevel: string; maxLevel: string }

const toRows = (ranges: YearGroupLevels[]): Row[] =>
  ranges.map((range, index) => ({
    key: index,
    yearGroup: String(range.yearGroup),
    minLevel: String(range.minLevel),
    maxLevel: String(range.maxLevel),
  }))

const toRange = (row: Row): YearGroupLevels => ({
  yearGroup: Number(row.yearGroup),
  minLevel: Number(row.minLevel),
  maxLevel: Number(row.maxLevel),
})

/** How the bands fall, e.g. "1L 0% · 1M 11% · … · 3H 89%". */
function bandsSummary(range: YearGroupLevels): string {
  const bands = getLevelBoundaries(range)
  if (bands.length === 0) return '—'
  const shown = bands.length > 6 ? [...bands.slice(0, 3), null, ...bands.slice(-2)] : bands
  return shown.map((band) => (band ? `${band.level} ${Math.round(band.minPercent)}%` : '…')).join(' · ')
}

export function YearGroupLevelsEditor({ initial }: { initial: YearGroupLevels[] }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initial))
  const [nextKey, setNextKey] = useState(initial.length)
  const [pending, startTransition] = useTransition()

  const update = (key: number, field: keyof Omit<Row, 'key'>, value: string) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)))

  const save = () =>
    startTransition(async () => {
      const result = await saveYearGroupLevelsAction(rows.map(toRange))
      if (result.error || !result.data) {
        toast.error(result.error ?? 'Could not save the level ranges.')
        return
      }
      setRows(toRows(result.data))
      setNextKey(result.data.length)
      toast.success('Level ranges saved')
    })

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-[var(--color-text-secondary)]">
              <th className="px-3 py-2">Year group</th>
              <th className="px-3 py-2">Lowest level</th>
              <th className="px-3 py-2">Highest level</th>
              <th className="px-3 py-2">Bands</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b last:border-b-0">
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={1}
                    max={13}
                    className="w-20"
                    aria-label="Year group"
                    value={row.yearGroup}
                    onChange={(e) => update(row.key, 'yearGroup', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={MIN_LEVEL}
                    max={MAX_LEVEL}
                    className="w-20"
                    aria-label="Lowest level"
                    value={row.minLevel}
                    onChange={(e) => update(row.key, 'minLevel', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={MIN_LEVEL}
                    max={MAX_LEVEL}
                    className="w-20"
                    aria-label="Highest level"
                    value={row.maxLevel}
                    onChange={(e) => update(row.key, 'maxLevel', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">{bandsSummary(toRange(row))}</td>
                <td className="px-3 py-2 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="p-3 text-sm text-[var(--color-text-secondary)]">No year groups: no report will show a level.</p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setRows((current) => [...current, { key: nextKey, yearGroup: '', minLevel: '1', maxLevel: '3' }])
            setNextKey((key) => key + 1)
          }}
        >
          Add year group
        </Button>
        <Button disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
