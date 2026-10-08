import { Badge } from '@/components/ui/badge'
import type { InterventionStatus } from '@/lib/interventions/store'

const LABELS: Record<InterventionStatus, string> = {
  assigned: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function InterventionStatusBadge({ status, overdue }: { status: InterventionStatus; overdue?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status === 'completed' ? (
        <Badge className="bg-emerald-600 text-white">{LABELS[status]}</Badge>
      ) : status === 'cancelled' ? (
        <Badge variant="outline" className="text-muted-foreground">{LABELS[status]}</Badge>
      ) : (
        <Badge variant="secondary">{LABELS[status]}</Badge>
      )}
      {overdue && (
        <Badge variant="outline" className="border-rose-400 text-rose-700 dark:text-rose-300">Overdue</Badge>
      )}
    </span>
  )
}

export function formatScore(score: number | null): string {
  return score === null ? '—' : `${Math.round(score * 100)}%`
}

/** "2026-10-08" or an ISO timestamp -> "08-10-2026". */
export function formatDay(value: string | null): string {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return year && month && day ? `${day}-${month}-${year}` : value
}
