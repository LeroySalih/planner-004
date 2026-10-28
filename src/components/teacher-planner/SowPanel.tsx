'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { readActiveSchoolYearsAction } from '@/lib/server-actions/school-years'
import { readHalfTermsAction } from '@/lib/server-actions/sow'
import { readGroupSowLessonsAction, type SowWeekLesson } from '@/lib/server-actions/planner-assignments'
import { academicYearFromGroupId, academicYearLabel } from '@/lib/academic-year'
import { buildSowWeeks } from '@/lib/sow/weeks'
import type { HalfTerm } from '@/types'

type Props = {
  groupId: string
  /** The week the planner is showing; picks the default year and half term. */
  currentWeek: string
  /** Changes whenever the planner changes this class's lessons, to reload. */
  refreshKey: string
}

/** Academic year a date falls in (September rollover). */
function yearOfDate(isoDate: string): number {
  const [y, m] = isoDate.split('-').map(Number)
  return m >= 9 ? y : y - 1
}

/** The half term containing the week, else the next one, else the last. */
function halfTermForWeek(halfTerms: HalfTerm[], week: string): HalfTerm['name'] | null {
  const sorted = [...halfTerms].sort((a, b) => a.name.localeCompare(b.name))
  const [y, m, d] = week.split('-').map(Number)
  const thursday = new Date(y, m - 1, d + 4)
  const weekEnd = `${thursday.getFullYear()}-${String(thursday.getMonth() + 1).padStart(2, '0')}-${String(thursday.getDate()).padStart(2, '0')}`
  const containing = sorted.find((ht) => ht.start_date <= weekEnd && ht.end_date >= week)
  if (containing) return containing.name
  return (sorted.find((ht) => ht.start_date > week) ?? sorted[sorted.length - 1])?.name ?? null
}

/**
 * The class's scheme of work for one half term: each week's lessons, planned
 * or still to come, with the class score for those already taught.
 */
export function SowPanel({ groupId, currentWeek, refreshKey }: Props) {
  const [years, setYears] = useState<number[]>([])
  const [year, setYear] = useState<number | null>(null)
  const [halfTerms, setHalfTerms] = useState<HalfTerm[] | null>(null)
  const [halfTerm, setHalfTerm] = useState<HalfTerm['name'] | null>(null)
  const [lessons, setLessons] = useState<SowWeekLesson[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void readActiveSchoolYearsAction().then((result) => {
      if (cancelled) return
      const active = (result.data ?? []).map((y) => y.year)
      // The week being planned decides the year; a class's own year (from its
      // id, "26-8C-DT" → 2026) is the fallback when that year is not active.
      const preferred = [yearOfDate(currentWeek), academicYearFromGroupId(groupId)]
      setYears(active)
      setYear(preferred.find((y) => y != null && active.includes(y)) ?? active[0] ?? yearOfDate(currentWeek))
    })
    return () => { cancelled = true }
    // Defaults are chosen once per class; changing week afterwards does not
    // move the teacher off the half term they picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  useEffect(() => {
    if (year == null) return
    let cancelled = false
    setHalfTerms(null)
    void readHalfTermsAction(year).then((result) => {
      if (cancelled) return
      const terms = result.data ?? []
      setHalfTerms(terms)
      setHalfTerm((prev) =>
        prev && terms.some((ht) => ht.name === prev) ? prev : halfTermForWeek(terms, currentWeek),
      )
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  useEffect(() => {
    if (year == null) return
    let cancelled = false
    void readGroupSowLessonsAction(groupId, year).then((result) => {
      if (cancelled) return
      setError(result.error)
      setLessons(result.data ?? [])
    })
    return () => { cancelled = true }
  }, [groupId, year, refreshKey])

  const weeks = useMemo(
    () => (halfTerms ? buildSowWeeks(halfTerms).filter((w) => w.halfTerm === halfTerm) : []),
    [halfTerms, halfTerm],
  )

  const lessonsByWeek = useMemo(() => {
    const map = new Map<string, SowWeekLesson[]>()
    for (const l of lessons ?? []) {
      const arr = map.get(l.week_start_date) ?? []
      arr.push(l)
      map.set(l.week_start_date, arr)
    }
    return map
  }, [lessons])

  const selectClass =
    'flex-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-2 py-1'

  return (
    <div className="border-t border-[var(--color-border)] pt-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-[var(--color-text-secondary)] m-0">Scheme of work</p>
        <Link
          href={`/sow/${encodeURIComponent(groupId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          title="Open the full scheme of work in a new tab"
        >
          Full SoW
        </Link>
      </div>

      <div className="flex gap-2 mb-2">
        <select
          className={selectClass}
          value={year ?? ''}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Academic year"
        >
          {years.map((y) => (
            <option key={y} value={y}>{academicYearLabel(y)}</option>
          ))}
        </select>
        <select
          className={selectClass}
          value={halfTerm ?? ''}
          onChange={(e) => setHalfTerm(e.target.value as HalfTerm['name'])}
          aria-label="Half term"
          disabled={!halfTerms || halfTerms.length === 0}
        >
          {[...(halfTerms ?? [])]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((ht) => (
              <option key={ht.name} value={ht.name}>{ht.name}</option>
            ))}
        </select>
      </div>

      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : !halfTerms || !lessons ? (
        <p className="text-xs text-[var(--color-text-tertiary)]">Loading…</p>
      ) : halfTerms.length === 0 ? (
        <p className="text-xs text-[var(--color-text-tertiary)]">
          Half terms are not set up for {academicYearLabel(year!)}.
        </p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
              <th className="py-1 pr-2 text-left font-semibold">Date</th>
              <th className="py-1 pr-2 text-left font-semibold">Lesson</th>
              <th className="py-1 text-right font-semibold">Score</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => {
              const weekLessons = lessonsByWeek.get(week.start) ?? []
              const isCurrent = week.start === currentWeek
              const date = (
                <span title={week.label}>{`W${week.number} · ${week.range.split(' – ')[0]}`}</span>
              )
              const rowClass = `border-t border-[var(--color-border)] ${isCurrent ? 'bg-[var(--color-background-secondary)] font-medium' : ''}`
              if (weekLessons.length === 0) {
                return (
                  <tr key={week.start} className={rowClass}>
                    <td className="py-1 pr-2 align-top whitespace-nowrap text-[var(--color-text-secondary)]">{date}</td>
                    <td className="py-1 pr-2 text-[var(--color-text-tertiary)]">—</td>
                    <td />
                  </tr>
                )
              }
              return weekLessons.map((l, i) => (
                <tr key={`${week.start}-${l.lesson_id}`} className={i === 0 ? rowClass : isCurrent ? 'bg-[var(--color-background-secondary)] font-medium' : ''}>
                  <td className="py-1 pr-2 align-top whitespace-nowrap text-[var(--color-text-secondary)]">
                    {i === 0 ? date : null}
                  </td>
                  <td className="py-1 pr-2 align-top">
                    <Link
                      href={`/lessons/${encodeURIComponent(l.lesson_id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {l.lesson_title}
                    </Link>
                  </td>
                  <td className="py-1 align-top text-right tabular-nums">
                    <Link
                      href={`/results/assignments/${groupId}__${l.lesson_id}`}
                      className={typeof l.score === 'number' ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}
                      title="View results"
                    >
                      {typeof l.score === 'number' ? `${l.score}%` : '--'}
                    </Link>
                  </td>
                </tr>
              ))
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
