import { requireTeacherProfile, requireTeacherOrAdminAccess } from '@/lib/auth'
import { query } from '@/lib/db'
import {
  readHalfTermsAction,
  readSowHalfTermUnitsAction,
  readSowUnitPlacementsAction,
  readSowUnitNotesAction,
  readGroupSowLessonsAction,
  readTeacherGroupsForSowAction,
  readUnitsAction,
} from '@/lib/server-updates'
import type { SowWeekLesson } from '@/lib/server-updates'
import { SOW_GROUP_ACCESS_PREDICATE } from '@/lib/sow/group-access'
import { SowClient } from './sow-client'
import { notFound } from 'next/navigation'
import { academicYearFromGroupId, fetchActiveAcademicYears, resolveCurrentAcademicYear } from '@/lib/academic-year'
import type { HalfTerm, SowHalfTermUnit, SowUnitNote, SowUnitPlacement, Unit } from '@/types'

type YearData = {
  halfTerms: HalfTerm[]
  htUnits: SowHalfTermUnit[]
  lessons: SowWeekLesson[]
  placements: SowUnitPlacement[]
  notes: SowUnitNote[]
}

async function fetchYearData(groupId: string, year: number): Promise<YearData> {
  const [ht, htu, lp, pl, nt] = await Promise.all([
    readHalfTermsAction(year),
    readSowHalfTermUnitsAction(groupId, year),
    readGroupSowLessonsAction(groupId, year),
    readSowUnitPlacementsAction(groupId, year),
    readSowUnitNotesAction(groupId, year),
  ])
  return {
    halfTerms: ht.data ?? [],
    htUnits: htu.data ?? [],
    lessons: lp.data ?? [],
    placements: pl.data ?? [],
    notes: nt.data ?? [],
  }
}

export default async function SowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>
  searchParams: Promise<{ teacherId?: string }>
}) {
  const { groupId } = await params
  const { teacherId } = await searchParams
  const profile = await requireTeacherProfile()
  const targetTeacherId = teacherId ?? profile.userId
  await requireTeacherOrAdminAccess(targetTeacherId)

  const years = await fetchActiveAcademicYears()
  // Default to the group's own academic year (from its id prefix, e.g.
  // "26-8B-DT" → 2026/27), falling back to the current year when the prefix
  // isn't a recognised active year.
  const derivedYear = academicYearFromGroupId(groupId)
  const year = derivedYear != null && years.includes(derivedYear)
    ? derivedYear
    : await resolveCurrentAcademicYear()

  const [groupsResult, unitsResult, initialData] = await Promise.all([
    readTeacherGroupsForSowAction(targetTeacherId),
    readUnitsAction(),
    fetchYearData(groupId, year),
  ])

  const group = (groupsResult.data ?? []).find((g) => g.group_id === groupId)
  if (!group) notFound()

  const units: Unit[] = unitsResult.data ?? []

  async function onYearChange(newYear: number): Promise<YearData> {
    'use server'
    await requireTeacherOrAdminAccess(targetTeacherId)
    // Same rule as the landing list. These two drifting apart is how a group
    // ends up listed but throwing "Unauthorized" the moment you change year.
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*) as count
         FROM groups g
        WHERE g.group_id = $2 AND g.active IS NOT FALSE AND (${SOW_GROUP_ACCESS_PREDICATE})`,
      [targetTeacherId, groupId],
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
        subject={group.subject ?? null}
        availableYears={years}
        initialYear={year}
        initialData={initialData}
        units={units}
        teacherId={targetTeacherId}
        onYearChange={onYearChange}
      />
    </main>
  )
}
