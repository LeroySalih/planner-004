import Link from 'next/link'
import type { HalfTerm, SowHalfTermUnit } from '@/types'

const HALF_TERM_NAMES = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] as const

type Props = {
  halfTerms: HalfTerm[]
  htUnits: SowHalfTermUnit[]
}

function formatDateRange(start: string, end: string): string {
  const fmt = (s: string) => {
    const d = new Date(s + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return `${fmt(start)} – ${fmt(end)}`
}

export function SowHalfTermTable({ halfTerms, htUnits }: Props) {
  const halfTermMap = new Map(halfTerms.map((ht) => [ht.name, ht]))

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
                  ? htUnits
                      .filter((u) => u.half_term_id === ht.id)
                      .sort((a, b) => a.position - b.position)
                  : []

                return (
                  <td
                    key={name}
                    className="border border-[var(--color-border)] bg-[var(--color-background-primary)] px-3 py-2 align-top"
                  >
                    <div className="flex flex-col gap-1">
                      {cellUnits.length === 0 ? (
                        <span className="text-xs text-[var(--color-text-tertiary)]">
                          No lessons scheduled
                        </span>
                      ) : (
                        cellUnits.map((cu) => (
                          <Link
                            key={cu.unit_id}
                            href={`/units/${encodeURIComponent(cu.unit_id)}`}
                            className="inline-flex items-center gap-1 rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-xs hover:border-[var(--color-text-primary)] hover:text-[var(--color-text-primary)]"
                          >
                            {cu.unit_name ?? cu.unit_id}
                          </Link>
                        ))
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
