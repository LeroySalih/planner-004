import { Fragment } from 'react'
import Link from 'next/link'
import type { SowWeekLesson } from '@/lib/server-updates'

type Props = {
  groupId: string
  weekLabel: string
  halfTermBadge: string
  isHoliday: boolean
  lessons: SowWeekLesson[]
  unitMap: Map<string, string>
}

const BADGE_COLOURS: Record<string, string> = {
  H1: 'bg-blue-100 text-blue-700',
  H2: 'bg-green-100 text-green-700',
  H3: 'bg-yellow-100 text-yellow-700',
  H4: 'bg-orange-100 text-orange-700',
  H5: 'bg-purple-100 text-purple-700',
  H6: 'bg-pink-100 text-pink-700',
}

export function SowWeekRow({ groupId, weekLabel, halfTermBadge, isHoliday, lessons, unitMap }: Props) {
  const badge = halfTermBadge ? (
    <span className={`inline-block rounded text-center text-xs font-semibold px-1.5 py-0.5 ${BADGE_COLOURS[halfTermBadge] ?? ''}`}>
      {halfTermBadge}
    </span>
  ) : null

  if (isHoliday) {
    return (
      <tr className="opacity-40">
        <td className="px-3 py-1.5 text-xs text-[var(--color-text-tertiary)] whitespace-nowrap" colSpan={5}>
          {weekLabel} · Holiday
        </td>
      </tr>
    )
  }

  if (lessons.length === 0) {
    return (
      <tr className="border-t border-[var(--color-border)]">
        <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)] whitespace-nowrap align-top">
          <div className="flex items-center gap-1.5">{badge}<span>{weekLabel}</span></div>
        </td>
        <td className="px-3 py-2" colSpan={4} />
      </tr>
    )
  }

  return (
    <Fragment>
      {lessons.map((l, i) => (
        <tr key={l.lesson_id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-background-secondary)]">
          {i === 0 ? (
            <td
              className="px-3 py-2 text-xs text-[var(--color-text-secondary)] whitespace-nowrap align-top"
              rowSpan={lessons.length}
            >
              <div className="flex items-center gap-1.5">{badge}<span>{weekLabel}</span></div>
            </td>
          ) : null}
          <td className="px-3 py-2 text-sm align-top">
            <Link
              href={`/units/${encodeURIComponent(l.unit_id)}`}
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline"
            >
              {unitMap.get(l.unit_id) ?? ''}
            </Link>
          </td>
          <td className="px-3 py-2 text-sm align-top">
            <Link
              href={`/lessons/${encodeURIComponent(l.lesson_id)}`}
              className="text-[var(--color-text-primary)] hover:underline"
            >
              {l.lesson_title}
            </Link>
          </td>
          <td className="px-3 py-2 text-sm text-right align-top tabular-nums">
            <Link
              href={`/unit-progress-reports/${encodeURIComponent(groupId)}/${encodeURIComponent(l.unit_id)}`}
              className={typeof l.score === 'number' ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}
              title="View results"
            >
              {typeof l.score === 'number' ? `${l.score}%` : '--'}
            </Link>
          </td>
          <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)] align-top">
            {l.los.join(', ')}
          </td>
        </tr>
      ))}
    </Fragment>
  )
}
