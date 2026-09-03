'use client'

import { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { readTeacherGroupsForSowAction } from '@/lib/server-updates'
import { academicYearFromGroupId, academicYearLabel } from '@/lib/academic-year'
import type { TeacherGroup } from '@/types'

type GroupSection = {
  /** Academic start year, or null for ids that do not follow the YY- pattern. */
  year: number | null
  label: string
  groups: TeacherGroup[]
}

/**
 * Group classes by the academic year in their id prefix ("25-8B-DT" → 2025/26),
 * most recent first. Anything not matching YY- (e.g. "HOME-SCHOOL") collects
 * into a single "Other" section, shown last.
 */
function groupByYear(groups: TeacherGroup[]): GroupSection[] {
  const byYear = new Map<number, TeacherGroup[]>()
  const other: TeacherGroup[] = []

  for (const group of groups) {
    const year = academicYearFromGroupId(group.group_id)
    if (year == null) {
      other.push(group)
      continue
    }
    const bucket = byYear.get(year)
    if (bucket) bucket.push(group)
    else byYear.set(year, [group])
  }

  const sections: GroupSection[] = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({
      year,
      label: academicYearLabel(year),
      groups: [...list].sort((a, b) => a.group_id.localeCompare(b.group_id)),
    }))

  if (other.length > 0) {
    sections.push({
      year: null,
      label: 'Other',
      groups: [...other].sort((a, b) => a.group_id.localeCompare(b.group_id)),
    })
  }

  return sections
}

type SowLandingClientProps = {
  initialGroups: TeacherGroup[]
  teachers: { userId: string; firstName: string | null; lastName: string | null }[]
  currentTeacherId: string
  isAdmin: boolean
}

export function SowLandingClient({ initialGroups, teachers, currentTeacherId, isAdmin }: SowLandingClientProps) {
  const [selectedTeacherId, setSelectedTeacherId] = useState(currentTeacherId)
  const [groups, setGroups] = useState<TeacherGroup[]>(initialGroups)

  const loadGroupsForTeacher = useCallback(async (teacherId: string) => {
    const result = await readTeacherGroupsForSowAction(teacherId)
    setGroups(result.data ?? [])
  }, [])

  const sections = useMemo(() => groupByYear(groups), [groups])

  return (
    <>
      {isAdmin && (
        <div className="mb-6">
          <select
            value={selectedTeacherId}
            onChange={(e) => {
              const teacherId = e.target.value
              setSelectedTeacherId(teacherId)
              loadGroupsForTeacher(teacherId)
            }}
            className="text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-2 py-1 text-[var(--color-text-primary)]"
          >
            {teachers.map((t) => (
              <option key={t.userId} value={t.userId}>
                {[t.firstName, t.lastName].filter(Boolean).join(' ') || t.userId}
                {t.userId === currentTeacherId ? ' (me)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          {selectedTeacherId === currentTeacherId
            ? 'No classes found. Set up your timetable in the Weekly Planner first.'
            : 'This teacher has no classes set up in the Weekly Planner yet.'}
        </p>
      ) : (
        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.year ?? 'other'}>
              <div className="mb-3 flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {section.label}
                </h2>
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {section.groups.length} {section.groups.length === 1 ? 'class' : 'classes'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {section.groups.map((g) => (
                  <Link
                    key={g.group_id}
                    href={selectedTeacherId === currentTeacherId ? `/sow/${g.group_id}` : `/sow/${g.group_id}?teacherId=${selectedTeacherId}`}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-5 hover:bg-[var(--color-background-tertiary)] transition-colors"
                  >
                    <p className="font-medium text-[var(--color-text-primary)]">{g.group_id}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">{g.subject}</p>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
                      {g.lessons_total} {g.lessons_total === 1 ? 'lesson' : 'lessons'} planned
                      {' · '}
                      {g.lessons_this_week} this week
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
