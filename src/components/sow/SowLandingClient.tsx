'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { readTeacherGroupsForSowAction } from '@/lib/server-updates'
import type { TeacherGroup } from '@/types'

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
          No classes found. Set up your timetable in the Weekly Planner first.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {groups.map((g) => (
            <Link
              key={g.group_id}
              href={selectedTeacherId === currentTeacherId ? `/sow/${g.group_id}` : `/sow/${g.group_id}?teacherId=${selectedTeacherId}`}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-5 hover:bg-[var(--color-background-tertiary)] transition-colors"
            >
              <p className="font-medium text-[var(--color-text-primary)]">{g.group_id}</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">{g.subject}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
