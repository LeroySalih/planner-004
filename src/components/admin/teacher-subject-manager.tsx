'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { updateTeacherSubjectsAction } from '@/lib/server-updates'

type TeacherRow = {
  userId: string
  displayName: string
}

type Props = {
  teachers: TeacherRow[]
  subjects: string[]
  initialAssignments: Map<string, string[]>
}

export function TeacherSubjectManager({ teachers, subjects, initialAssignments }: Props) {
  const [assignments, setAssignments] = useState<Map<string, string[]>>(initialAssignments)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  async function handleToggle(userId: string, subject: string, checked: boolean) {
    const current = assignments.get(userId) ?? []
    const next = checked ? [...current, subject] : current.filter((s) => s !== subject)

    const key = `${userId}::${subject}`
    setSavingKey(key)
    const { error } = await updateTeacherSubjectsAction(userId, next)
    setSavingKey(null)

    if (error) {
      toast.error(error)
      return
    }

    setAssignments((prev) => {
      const updated = new Map(prev)
      updated.set(userId, next)
      return updated
    })
    toast.success(checked ? `Added ${subject}` : `Removed ${subject}`)
  }

  if (teachers.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">No teacher profiles found.</p>
  }

  if (subjects.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">No active subjects configured yet.</p>
  }

  return (
    <div
      className="overflow-x-auto rounded-md border border-[var(--color-border)] [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:auto]"
      style={{ scrollbarGutter: 'stable' }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="sticky left-0 z-10 bg-[var(--color-background)] px-4 py-2 text-left font-medium text-[var(--color-text-primary)]">
              Teacher
            </th>
            {subjects.map((subject) => (
              <th key={subject} className="px-4 py-2 text-center font-medium text-[var(--color-text-primary)] whitespace-nowrap">
                {subject}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teachers.map((teacher) => {
            const teacherSubjects = assignments.get(teacher.userId) ?? []
            return (
              <tr key={teacher.userId} className="border-b border-[var(--color-border)] last:border-0">
                <td className="sticky left-0 z-10 bg-[var(--color-background)] px-4 py-2 text-[var(--color-text-primary)]">
                  {teacher.displayName}
                </td>
                {subjects.map((subject) => {
                  const key = `${teacher.userId}::${subject}`
                  return (
                    <td key={key} className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={teacherSubjects.includes(subject)}
                        disabled={savingKey === key}
                        onChange={(e) => handleToggle(teacher.userId, subject, e.target.checked)}
                      />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
