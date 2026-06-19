'use client'

import { useState } from 'react'
import { SowHalfTermTable } from '@/components/sow/SowHalfTermTable'
import { SowWeekList } from '@/components/sow/SowWeekList'
import type { HalfTerm, SowHalfTermUnit, TeacherGroup, Unit } from '@/types'
import type { SowWeekLesson } from '@/lib/server-updates'

type YearData = {
  halfTerms: HalfTerm[]
  htUnits: SowHalfTermUnit[]
  lessons: SowWeekLesson[]
}

type Props = {
  groupId: string
  groupName: string
  availableYears: number[]
  initialYear: number
  initialData: YearData
  units: Unit[]
  allGroups: TeacherGroup[]
  onYearChange: (year: number) => Promise<YearData>
}

export function SowClient({
  groupId,
  groupName,
  availableYears,
  initialYear,
  initialData,
  units,
  allGroups,
  onYearChange,
}: Props) {
  const [year, setYear] = useState(initialYear)
  const [dataByYear, setDataByYear] = useState<Record<number, YearData>>({
    [initialYear]: initialData,
  })

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
        key={`ht-${year}`}
        groupId={groupId}
        year={year}
        halfTerms={currentData.halfTerms}
        htUnits={currentData.htUnits}
        units={units}
        allGroups={allGroups}
      />

      <SowWeekList
        key={`wl-${year}`}
        groupId={groupId}
        halfTerms={currentData.halfTerms}
        lessons={currentData.lessons}
        units={units}
      />
    </>
  )
}
