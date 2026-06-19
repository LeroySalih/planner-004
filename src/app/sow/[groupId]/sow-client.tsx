'use client'

import { useState } from 'react'
import { SowHalfTermTable } from '@/components/sow/SowHalfTermTable'
import { SowWeekList } from '@/components/sow/SowWeekList'
import type { HalfTerm, SowHalfTermUnit, SowLessonPlan, Unit } from '@/types'

type LessonMeta = { lesson_id: string; title: string }

type YearData = {
  halfTerms: HalfTerm[]
  htUnits: SowHalfTermUnit[]
  lessonPlans: SowLessonPlan[]
}

type Props = {
  groupId: string
  groupName: string
  availableYears: number[]
  initialYear: number
  initialData: YearData
  units: Unit[]
  lessonMetas: LessonMeta[]
  onYearChange: (year: number) => Promise<YearData>
}

export function SowClient({
  groupId,
  groupName,
  availableYears,
  initialYear,
  initialData,
  units,
  lessonMetas,
  onYearChange,
}: Props) {
  const [year, setYear] = useState(initialYear)
  const [dataByYear, setDataByYear] = useState<Record<number, YearData>>({
    [initialYear]: initialData,
  })

  const lessonTitleMap = new Map(lessonMetas.map((l) => [l.lesson_id, l.title]))
  const currentData = dataByYear[year] ?? initialData

  async function handleYearChange(newYear: number) {
    setYear(newYear)
    if (dataByYear[newYear]) return
    const result = await onYearChange(newYear)
    setDataByYear((prev) => ({ ...prev, [newYear]: result }))
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium text-[var(--color-text-primary)]">
          {groupName} — Scheme of Work
        </h1>
        <select
          value={year}
          onChange={(e) => handleYearChange(Number(e.target.value))}
          className="text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-2 py-1 text-[var(--color-text-primary)]"
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}/{String(y + 1).slice(2)}</option>
          ))}
        </select>
      </div>

      <SowHalfTermTable
        groupId={groupId}
        halfTerms={currentData.halfTerms}
        htUnits={currentData.htUnits}
        units={units}
      />

      <SowWeekList
        groupId={groupId}
        halfTerms={currentData.halfTerms}
        initialLessons={currentData.lessonPlans}
        units={units}
        lessonTitleMap={lessonTitleMap}
      />
    </>
  )
}
