'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  createMarkingGuidanceAction,
  updateMarkingGuidanceAction,
  setMarkingGuidanceActiveAction,
} from '@/lib/server-updates'
import type { MarkingGuidance, Subject } from '@/types'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/ui/rich-text-editor'

type Props = {
  subjects: Subject[]
  initialGuidances: MarkingGuidance[]
}

function sortGuidances(guidances: MarkingGuidance[]): MarkingGuidance[] {
  return [...guidances].sort((a, b) => {
    const subjectCompare = a.subject.localeCompare(b.subject)
    if (subjectCompare !== 0) return subjectCompare
    return a.title.localeCompare(b.title)
  })
}

export function MarkingGuidanceManager({ subjects, initialGuidances }: Props) {
  const [guidances, setGuidances] = useState<MarkingGuidance[]>(sortGuidances(initialGuidances))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [subject, setSubject] = useState(subjects[0]?.subject ?? '')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const activeSubjects = useMemo(() => subjects.filter((s) => s.active), [subjects])

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setContent('')
  }

  function startEdit(guidance: MarkingGuidance) {
    setEditingId(guidance.id)
    setSubject(guidance.subject)
    setTitle(guidance.title)
    setContent(guidance.content)
  }

  async function handleSave() {
    const trimmedTitle = title.trim()
    const trimmedContent = content.trim()
    if (!trimmedTitle || !trimmedContent) {
      toast.error('Title and content are required')
      return
    }
    setSaving(true)
    if (editingId) {
      const { error } = await updateMarkingGuidanceAction({ id: editingId, title: trimmedTitle, content: trimmedContent })
      setSaving(false)
      if (error) {
        toast.error(error)
        return
      }
      setGuidances((prev) =>
        sortGuidances(prev.map((g) => (g.id === editingId ? { ...g, title: trimmedTitle, content: trimmedContent } : g))),
      )
      toast.success('Marking guidance updated')
      resetForm()
      return
    }

    if (!subject) {
      setSaving(false)
      toast.error('Select a subject')
      return
    }
    const { data, error } = await createMarkingGuidanceAction({ subject, title: trimmedTitle, content: trimmedContent })
    setSaving(false)
    if (error) {
      toast.error(error)
      return
    }
    if (!data) {
      toast.error('Failed to create guidance: no id returned')
      return
    }
    setGuidances((prev) =>
      sortGuidances([
        ...prev,
        { id: data.id, subject, title: trimmedTitle, content: trimmedContent, active: true },
      ]),
    )
    toast.success(`Added ${trimmedTitle}`)
    resetForm()
  }

  async function handleToggleActive(guidance: MarkingGuidance) {
    const { error } = await setMarkingGuidanceActiveAction(guidance.id, !guidance.active)
    if (error) {
      toast.error(error)
      return
    }
    setGuidances((prev) => prev.map((g) => (g.id === guidance.id ? { ...g, active: !guidance.active } : g)))
    toast.success(!guidance.active ? 'Guidance activated' : 'Guidance deactivated')
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-md border border-[var(--color-border)] p-4">
        <div className="flex items-center gap-2">
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={!!editingId}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
          >
            {activeSubjects.map((s) => (
              <option key={s.subject} value={s.subject}>
                {s.subject}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
          />
        </div>
        <RichTextEditor
          id="marking-guidance-content"
          value={content}
          onChange={setContent}
          placeholder="Markdown guidance content"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving || !title.trim() || !content.trim()}>
            {editingId ? 'Save changes' : 'Add guidance'}
          </Button>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-md border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
        {guidances.length === 0 && (
          <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">No marking guidances configured.</p>
        )}
        {guidances.map((g) => (
          <div key={g.id} className="flex items-center justify-between px-4 py-3 gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-xs rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-tertiary)]">
                {g.subject}
              </span>
              <span
                className={`text-sm font-medium ${g.active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] line-through'}`}
              >
                {g.title}
              </span>
              {!g.active && (
                <span className="text-xs rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-tertiary)]">
                  inactive
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => startEdit(g)}>
                Edit
              </Button>
              <Button size="sm" variant={g.active ? 'ghost' : 'outline'} onClick={() => handleToggleActive(g)}>
                {g.active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
