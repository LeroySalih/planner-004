import type { HalfTerm } from '@/types'

export type SowWeek = {
  /** Sunday the week starts, YYYY-MM-DD. */
  start: string
  /** Null for a holiday week. */
  halfTerm: HalfTerm['name'] | null
  /** Counted across the year, holidays excluded; 0 before the first half term. */
  number: number
  /** e.g. "18 Oct – 22 Oct" */
  range: string
  /** e.g. "Week 7 · 18 Oct – 22 Oct" */
  label: string
}

function toLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Every Sunday-to-Thursday week from the first half term's start to the last
 * one's end, each tagged with its half term (or none, for a holiday). The SoW
 * page and the planner's SoW panel both number weeks from this, so "Week 7"
 * means the same week in both.
 */
export function buildSowWeeks(halfTerms: HalfTerm[]): SowWeek[] {
  if (halfTerms.length === 0) return []
  const sorted = [...halfTerms].sort((a, b) => a.name.localeCompare(b.name))

  const weekToHt = new Map<string, HalfTerm['name']>()
  for (const ht of sorted) {
    let cur = toLocalDate(ht.start_date)
    cur.setDate(cur.getDate() - cur.getDay())
    const end = toLocalDate(ht.end_date)
    while (cur <= end) {
      weekToHt.set(toIsoDate(cur), ht.name)
      cur = addDays(cur, 7)
    }
  }

  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  const yearEnd = toLocalDate(sorted[sorted.length - 1].end_date)
  const weeks: SowWeek[] = []
  let cur = toLocalDate(sorted[0].start_date)
  cur.setDate(cur.getDate() - cur.getDay())
  let number = 0
  while (cur <= yearEnd) {
    const start = toIsoDate(cur)
    const halfTerm = weekToHt.get(start) ?? null
    if (halfTerm) number++
    const range = `${fmt(cur)} – ${fmt(addDays(cur, 4))}`
    weeks.push({ start, halfTerm, number, range, label: `Week ${number} · ${range}` })
    cur = addDays(cur, 7)
  }
  return weeks
}
