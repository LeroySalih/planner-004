import { requireTeacherProfile } from '@/lib/auth'
import { query } from '@/lib/db'
import {
  readHalfTermsAction,
  readSowHalfTermUnitsAction,
  readSowLessonPlanAction,
  readTeacherGroupsForSowAction,
  readUnitsAction,
  readLessonsByUnitAction,
} from '@/lib/server-updates'
import { SowClient } from './sow-client'
import { notFound } from 'next/navigation'
import { currentAcademicYear, availableAcademicYears } from '@/lib/academic-year'
import type { HalfTerm, SowHalfTermUnit, SowLessonPlan, LessonMeta } from '@/types'

type YearData = {
  halfTerms: HalfTerm[]
  htUnits: SowHalfTermUnit[]
  lessonPlans: SowLessonPlan[]
  lessonMetas: LessonMeta[]
}

async function fetchYearData(groupId: string, year: number): Promise<YearData> {
  const [ht, htu, lp] = await Promise.all([
    readHalfTermsAction(year),
    readSowHalfTermUnitsAction(groupId, year),
    readSowLessonPlanAction(groupId, year),
  ])
  const lessonPlans = lp.data ?? []
  const uniqueUnitIds = [...new Set(lessonPlans.map((l) => l.unit_id))]
  const lessonsByUnit = await Promise.all(uniqueUnitIds.map((uid) => readLessonsByUnitAction(uid)))
  const lessonMetas = lessonsByUnit.flatMap((r) =>
    (r.data ?? []).map((l) => ({ lesson_id: l.lesson_id, title: l.title })),
  )
  return {
    halfTerms: ht.data ?? [],
    htUnits: htu.data ?? [],
    lessonPlans,
    lessonMetas,
  }
}

export default async function SowDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  await requireTeacherProfile()

  const year = currentAcademicYear()
  const years = availableAcademicYears(year)

  const [groupsResult, unitsResult, initialData] = await Promise.all([
    readTeacherGroupsForSowAction(),
    readUnitsAction(),
    fetchYearData(groupId, year),
  ])

  const group = (groupsResult.data ?? []).find((g) => g.group_id === groupId)
  if (!group) notFound()

  const units = unitsResult.data ?? []

  async function onYearChange(newYear: number): Promise<YearData> {
    'use server'
    const profile = await requireTeacherProfile()
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM timetable_slot_groups WHERE teacher_id = $1 AND group_id = $2`,
      [profile.userId, groupId],
    )
    if (Number(rows[0]?.count ?? 0) === 0) {
      throw new Error('Unauthorized: group does not belong to this teacher')
    }
    return fetchYearData(groupId, newYear)
  }

  return (
    <main className="max-w-5xl mx-auto p-8">
      <SowClient
        groupId={groupId}
        groupName={`${groupId} · ${group.subject ?? ''}`}
        availableYears={years}
        initialYear={year}
        initialData={initialData}
        units={units}
        onYearChange={onYearChange}
      />
    </main>
  )
}
