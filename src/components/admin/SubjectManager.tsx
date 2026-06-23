'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { createSubjectAction, setSubjectActiveAction } from '@/lib/server-updates'
import type { Subject } from '@/types'
import { Button } from '@/components/ui/button'

type Props = {
  initialSubjects: Subject[]
}

function sortSubjects(subjects: Subject[]): Subject[] {
  return [...subjects].sort((a, b) => a.subject.localeCompare(b.subject))
}

export function SubjectManager({ initialSubjects }: Props) {
  const [subjects, setSubjects] = useState<Subject[]>(sortSubjects(initialSubjects))
  const [newSubject, setNewSubject] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    const trimmed = newSubject.trim()
    if (!trimmed) {
      toast.error('Enter a subject name')
      return
    }
    if (subjects.find((s) => s.subject.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('This subject already exists')
      return
    }
    setSaving(true)
    const { error } = await createSubjectAction(trimmed)
    setSaving(false)
    if (error) {
      toast.error(error)
      return
    }
    setSubjects((prev) => sortSubjects([...prev, { subject: trimmed, active: true }]))
    setNewSubject('')
    toast.success(`Added ${trimmed}`)
  }

  async function handleToggleActive(subject: string, currentActive: boolean) {
    const { error } = await setSubjectActiveAction(subject, !currentActive)
    if (error) {
      toast.error(error)
      return
    }
    setSubjects((prev) =>
      prev.map((s) => (s.subject === subject ? { ...s, active: !currentActive } : s)),
    )
    toast.success(!currentActive ? 'Subject activated' : 'Subject deactivated')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Subject name e.g. Geography"
          value={newSubject}
          onChange={(e) => setNewSubject(e.target.value)}
          className="w-52 rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
        />
        <Button size="sm" onClick={handleAdd} disabled={saving || !newSubject}>
          Add subject
        </Button>
      </div>

      <div className="rounded-md border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
        {subjects.length === 0 && (
          <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">No subjects configured.</p>
        )}
        {subjects.map((s) => (
          <div key={s.subject} className="flex items-center justify-between px-4 py-3 gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span
                className={`text-sm font-medium ${s.active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] line-through'}`}
              >
                {s.subject}
              </span>
              {!s.active && (
                <span className="text-xs rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-tertiary)]">
                  inactive
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant={s.active ? 'ghost' : 'outline'}
                onClick={() => handleToggleActive(s.subject, s.active)}
              >
                {s.active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
