'use client'

import { SowWeekRow } from './SowWeekRow'
import type { HalfTerm, Unit } from '@/types'
import type { SowWeekLesson } from '@/lib/server-updates'
import { buildSowWeeks } from '@/lib/sow/weeks'

type Props = {
  groupId: string
  halfTerms: HalfTerm[]
  lessons: SowWeekLesson[]
  units: Unit[]
  teacherId: string
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

  const lessonsByWeek = new Map<string, SowWeekLesson[]>()
  for (const l of lessons) {
    const arr = lessonsByWeek.get(l.week_start_date) ?? []
    arr.push(l)
    lessonsByWeek.set(l.week_start_date, arr)
  }

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
          {buildSowWeeks(halfTerms).map((week) => (
            <SowWeekRow
              key={week.start}
              groupId={groupId}
              weekLabel={week.label}
              weekStartIso={week.start}
              teacherId={teacherId}
              halfTermBadge={week.halfTerm ?? ''}
              isHoliday={!week.halfTerm}
              lessons={lessonsByWeek.get(week.start) ?? []}
              unitMap={unitMap}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
