'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getLevelBoundaries, TOP_LEVELS, type YearGroupLevels } from '@/lib/levels'
import { saveYearGroupLevelsAction } from '@/lib/server-updates'

type Row = { key: number; yearGroup: string; topLevel: string }

const toRows = (ranges: YearGroupLevels[]): Row[] =>
  ranges.map((range, index) => ({ key: index, yearGroup: String(range.yearGroup), topLevel: range.topLevel }))

const toRange = (row: Row): YearGroupLevels => ({ yearGroup: Number(row.yearGroup), topLevel: row.topLevel })

/** Where each level starts, e.g. "1L 0% · 1M 13% · … · 5M 93%". */
function Bands({ range }: { range: YearGroupLevels }) {
  const bands = getLevelBoundaries(range)
  if (bands.length === 0) return <>—</>
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {bands.map((band) => (
        <span key={band.level} className="whitespace-nowrap">
          <span className="font-medium text-foreground">{band.level}</span> {band.minPercent}%
        </span>
      ))}
    </div>
  )
}

export function YearGroupLevelsEditor({ initial }: { initial: YearGroupLevels[] }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initial))
  const [nextKey, setNextKey] = useState(initial.length)
  const [pending, startTransition] = useTransition()

  const update = (key: number, field: 'yearGroup' | 'topLevel', value: string) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)))

  const save = () =>
    startTransition(async () => {
      const result = await saveYearGroupLevelsAction(rows.map(toRange))
      if (result.error || !result.data) {
        toast.error(result.error ?? 'Could not save the levels.')
        return
      }
      setRows(toRows(result.data))
      setNextKey(result.data.length)
      toast.success('Levels saved')
    })

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-[var(--color-text-secondary)]">
              <th className="px-3 py-2">Year group</th>
              <th className="px-3 py-2">Top level</th>
              <th className="px-3 py-2">Each level starts at</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b align-top last:border-b-0">
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
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    aria-label="Top level"
                    value={row.topLevel}
                    onChange={(e) => update(row.key, 'topLevel', e.target.value)}
                  >
                    {TOP_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                  <Bands range={toRange(row)} />
                </td>
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
            setRows((current) => [...current, { key: nextKey, yearGroup: '', topLevel: '5M' }])
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
