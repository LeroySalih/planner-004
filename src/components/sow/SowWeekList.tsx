'use client'

import { useState } from 'react'
import { SowWeekRow } from './SowWeekRow'
import type { HalfTerm, SowLessonPlan, Unit } from '@/types'

type Props = {
  groupId: string
  halfTerms: HalfTerm[]
  initialLessons: SowLessonPlan[]
  units: Unit[]
  lessonTitleMap: Map<string, string>
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

export function SowWeekList({ groupId, halfTerms, initialLessons, units, lessonTitleMap }: Props) {
  const [lessonsByWeek, setLessonsByWeek] = useState<Map<string, SowLessonPlan[]>>(() => {
    const map = new Map<string, SowLessonPlan[]>()
    for (const l of initialLessons) {
      const arr = map.get(l.week_start_date) ?? []
      arr.push(l)
      map.set(l.week_start_date, arr)
    }
    return map
  })

  if (halfTerms.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)] mt-4">
        Half terms are not configured. Ask an admin to set up H1–H6 dates.
      </p>
    )
  }

  const sortedHT = [...halfTerms].sort((a, b) => a.name.localeCompare(b.name))
  const yearStart = toLocalDate(sortedHT[0].start_date)
  const yearEnd = toLocalDate(sortedHT[sortedHT.length - 1].end_date)

  const weekToHt = new Map<string, string>()
  for (const ht of sortedHT) {
    let cur = toLocalDate(ht.start_date)
    cur.setDate(cur.getDate() - cur.getDay()) // snap to Sunday
    const end = toLocalDate(ht.end_date)
    while (cur <= end) {
      weekToHt.set(toIsoDate(cur), ht.name)
      cur = addDays(cur, 7)
    }
  }

  const weeks: Date[] = []
  let cur = new Date(yearStart)
  cur.setDate(cur.getDate() - cur.getDay()) // snap to Sunday
  while (cur <= yearEnd) {
    weeks.push(new Date(cur))
    cur = addDays(cur, 7)
  }

  function handleLessonsChange(weekStartDate: string, updated: SowLessonPlan[]) {
    setLessonsByWeek((prev) => {
      const next = new Map(prev)
      next.set(weekStartDate, updated)
      return next
    })
  }

  let weekNum = 0
  return (
    <div className="flex flex-col">
      {weeks.map((weekStart) => {
        const iso = toIsoDate(weekStart)
        const htName = weekToHt.get(iso)
        const lessons = lessonsByWeek.get(iso) ?? []
        if (htName) weekNum++
        return (
          <SowWeekRow
            key={iso}
            groupId={groupId}
            weekStartDate={iso}
            weekLabel={formatWeekLabel(weekStart, weekNum)}
            halfTermBadge={htName ?? ''}
            isHoliday={!htName}
            lessons={lessons}
            units={units}
            lessonTitleMap={lessonTitleMap}
            onLessonsChange={handleLessonsChange}
          />
        )
      })}
    </div>
  )
}
