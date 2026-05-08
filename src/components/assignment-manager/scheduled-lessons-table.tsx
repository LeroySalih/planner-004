'use client'

import { useEffect, useState } from 'react'
import { readLessonAssignmentsAction } from '@/lib/server-updates'
import type { LessonAssignment } from '@/types'

export function ScheduledLessonsTable() {
  const [assignments, setAssignments] = useState<LessonAssignment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    readLessonAssignmentsAction().then(({ data }) => {
      if (data) setAssignments(data)
      setLoading(false)
    })
  }, [])

  if (loading) return <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
  if (assignments.length === 0) return <p className="text-sm text-[var(--color-text-secondary)]">No lessons scheduled yet. Use the planner to schedule lessons.</p>

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b border-[var(--color-border)]">
          <th className="text-left py-2 px-3 font-medium text-[var(--color-text-secondary)]">Group</th>
          <th className="text-left py-2 px-3 font-medium text-[var(--color-text-secondary)]">Lesson</th>
          <th className="text-left py-2 px-3 font-medium text-[var(--color-text-secondary)]">First scheduled</th>
          <th className="text-left py-2 px-3 font-medium text-[var(--color-text-secondary)]">Feedback</th>
        </tr>
      </thead>
      <tbody>
        {assignments.map((a) => (
          <tr key={`${a.group_id}-${a.lesson_id}`} className="border-b border-[var(--color-border-secondary)]">
            <td className="py-2 px-3">{a.group_id}</td>
            <td className="py-2 px-3">{a.lesson_id}</td>
            <td className="py-2 px-3">{a.start_date}</td>
            <td className="py-2 px-3">{a.feedback_visible ? 'On' : 'Off'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
