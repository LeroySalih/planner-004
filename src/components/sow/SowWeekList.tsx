'use client'

import { SowWeekRow } from './SowWeekRow'
import type { HalfTerm, Unit } from '@/types'
import type { SowWeekLesson } from '@/lib/server-updates'

type Props = {
  groupId: string
  halfTerms: HalfTerm[]
  lessons: SowWeekLesson[]
  units: Unit[]
  teacherId: string
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

function formatWeekLabel(weekStart: Date, weekNum: number): string {
  const end = addDays(weekStart, 4)
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  return `Week ${weekNum} · ${fmt(weekStart)} – ${fmt(end)}`
}

export function SowWeekList({ groupId, halfTerms, lessons, units, teacherId }: Props) {
  if (halfTerms.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)] mt-4">
        Half terms are not configured. Ask an admin to set up H1–H6 dates.
      </p>
    )
  }

  const unitMap = new Map(units.map((u) => [u.unit_id, u.title]))

  const sortedHT = [...halfTerms].sort((a, b) => a.name.localeCompare(b.name))
  const yearStart = toLocalDate(sortedHT[0].start_date)
  const yearEnd = toLocalDate(sortedHT[sortedHT.length - 1].end_date)

  const weekToHt = new Map<string, string>()
  for (const ht of sortedHT) {
    let cur = toLocalDate(ht.start_date)
    cur.setDate(cur.getDate() - cur.getDay())
    const end = toLocalDate(ht.end_date)
    while (cur <= end) {
      weekToHt.set(toIsoDate(cur), ht.name)
      cur = addDays(cur, 7)
    }
  }

  const lessonsByWeek = new Map<string, SowWeekLesson[]>()
  for (const l of lessons) {
    const arr = lessonsByWeek.get(l.week_start_date) ?? []
    arr.push(l)
    lessonsByWeek.set(l.week_start_date, arr)
  }

  const weeks: Date[] = []
  let cur = new Date(yearStart)
  cur.setDate(cur.getDate() - cur.getDay())
  while (cur <= yearEnd) {
    weeks.push(new Date(cur))
    cur = addDays(cur, 7)
  }

  let weekNum = 0
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-text-secondary)] whitespace-nowrap w-48">Date</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-text-secondary)] w-48">Unit</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-text-secondary)]">Lesson</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--color-text-secondary)] w-16">Score</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-text-secondary)]">Learning Objectives</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((weekStart) => {
            const iso = toIsoDate(weekStart)
            const htName = weekToHt.get(iso)
            const weekLessons = lessonsByWeek.get(iso) ?? []
            if (htName) weekNum++
            return (
              <SowWeekRow
                key={iso}
                groupId={groupId}
                weekLabel={formatWeekLabel(weekStart, weekNum)}
                weekStartIso={iso}
                teacherId={teacherId}
                halfTermBadge={htName ?? ''}
                isHoliday={!htName}
                lessons={weekLessons}
                unitMap={unitMap}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
