'use client'

import { useState } from 'react'
import { upsertHalfTermAction, readHalfTermsAction } from '@/lib/server-updates'
import { toast } from 'sonner'
import type { HalfTerm } from '@/types'
import { academicYearLabel } from '@/lib/academic-year'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const NAMES = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] as const

type Props = {
  year: number
  activeYears: number[]
  initialHalfTerms: HalfTerm[]
}

export function HalfTermManager({ year: initialYear, activeYears, initialHalfTerms }: Props) {
  const [year, setYear] = useState(initialYear)
  const [halfTerms, setHalfTerms] = useState<HalfTerm[]>(initialHalfTerms)
  const [saving, setSaving] = useState<string | null>(null)
  const [loadingYear, setLoadingYear] = useState(false)

  async function handleYearChange(val: string) {
    const newYear = parseInt(val, 10)
    setLoadingYear(true)
    const { data } = await readHalfTermsAction(newYear)
    setYear(newYear)
    setHalfTerms(data ?? [])
    setLoadingYear(false)
  }

  function getValue(name: string, field: 'start_date' | 'end_date'): string {
    return halfTerms.find((ht) => ht.name === name)?.[field] ?? ''
  }

  function handleChange(name: string, field: 'start_date' | 'end_date', value: string) {
    setHalfTerms((prev) => {
      const existing = prev.find((ht) => ht.name === name)
      if (existing) {
        return prev.map((ht) => ht.name === name ? { ...ht, [field]: value } : ht)
      }
      return [
        ...prev,
        {
          id: '',
          year,
          name: name as HalfTerm['name'],
          start_date: field === 'start_date' ? value : '',
          end_date: field === 'end_date' ? value : '',
        },
      ]
    })
  }

  async function handleSave(name: typeof NAMES[number]) {
    const ht = halfTerms.find((h) => h.name === name)
    if (!ht?.start_date || !ht?.end_date) {
      toast.error('Set both dates before saving')
      return
    }
    setSaving(name)
    const { error, data } = await upsertHalfTermAction(year, name, ht.start_date, ht.end_date)
    setSaving(null)
    if (error) { toast.error(`Failed to save ${name}`); return }
    if (data) {
      setHalfTerms((prev) => prev.map((h) => h.name === name ? data : h))
    }
    toast.success(`${name} saved`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold">Half Terms</h2>
        <Select value={String(year)} onValueChange={handleYearChange} disabled={loadingYear}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {activeYears.map((y) => (
              <SelectItem key={y} value={String(y)}>{academicYearLabel(y)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {NAMES.map((name) => (
          <div
            key={name}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4 space-y-2"
          >
            <p className="font-medium text-sm">{name}</p>
            <label className="block text-xs text-[var(--color-text-secondary)]">
              Start
              <input
                type="date"
                value={getValue(name, 'start_date')}
                onChange={(e) => handleChange(name, 'start_date', e.target.value)}
                className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-2 py-1 text-sm"
              />
            </label>
            <label className="block text-xs text-[var(--color-text-secondary)]">
              End
              <input
                type="date"
                value={getValue(name, 'end_date')}
                onChange={(e) => handleChange(name, 'end_date', e.target.value)}
                className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-2 py-1 text-sm"
              />
            </label>
            <Button
              size="sm"
              onClick={() => handleSave(name)}
              disabled={saving === name}
            >
              {saving === name ? 'Saving…' : 'Save'}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
