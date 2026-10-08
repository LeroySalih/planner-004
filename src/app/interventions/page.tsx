import Link from 'next/link'

import { AssessmentGroupFilter } from '@/components/assessments/group-filter'
import { InterventionStatusBadge, formatDay, formatScore } from '@/components/interventions/status-badge'
import { TeacherPageLayout } from '@/components/layouts/TeacherPageLayout'
import { readInterventionsAction } from '@/lib/server-actions/interventions'
import { cn } from '@/lib/utils'

type PageProps = {
  searchParams: Promise<{ group?: string; pupil?: string; status?: string }>
}

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

export default async function InterventionsPage({ searchParams }: PageProps) {
  const { group, pupil, status } = await searchParams
  const groupId = group?.trim() || null
  const pupilId = pupil?.trim() || null
  const tab = STATUS_TABS.some((t) => t.value === status) ? (status ?? '') : ''

  // Read once unfiltered by status, so the tab counts and the group list come
  // from the same rows the table is cut from.
  const { data, error } = await readInterventionsAction({ groupId: groupId ?? undefined, pupilId: pupilId ?? undefined })
  const all = data ?? []
  const matches = (value: string) => (i: (typeof all)[number]) =>
    value === 'open' ? i.status === 'assigned' || i.status === 'in_progress'
      : value === 'overdue' ? i.overdue
        : value === '' ? i.status !== 'cancelled'
          : i.status === value
  const rows = all.filter(matches(tab))
  const groupIds = [...new Set(all.map((i) => i.group_id).filter((g): g is string => Boolean(g)))].sort()
  const pupilName = pupilId ? all.find((i) => i.pupil_id === pupilId)?.pupil_name ?? pupilId : null

  const hrefFor = (next: { status?: string; pupil?: string | null }) => {
    const params = new URLSearchParams()
    if (groupId) params.set('group', groupId)
    const nextPupil = next.pupil === undefined ? pupilId : next.pupil
    if (nextPupil) params.set('pupil', nextPupil)
    const nextStatus = next.status === undefined ? tab : next.status
    if (nextStatus) params.set('status', nextStatus)
    const query = params.toString()
    return query ? `/interventions?${query}` : '/interventions'
  }

  return (
    <TeacherPageLayout
      title="Interventions"
      subtitle="Lessons written for one pupil. Claude creates them through MCP; status and score update as the pupil works."
      headerAction={groupIds.length > 0 && <AssessmentGroupFilter groupIds={groupIds} value={groupId} />}
    >
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.value}
            href={hrefFor({ status: t.value })}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              t.value === tab ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {t.label} <span className="tabular-nums opacity-70">{all.filter(matches(t.value)).length}</span>
          </Link>
        ))}
        {pupilName && (
          <Link href={hrefFor({ pupil: null })} className="rounded-full border px-3 py-1 text-sm hover:bg-muted">
            Pupil: {pupilName} ✕
          </Link>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && rows.length === 0 && <p className="text-sm text-muted-foreground">No interventions match.</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Pupil</th>
                <th className="px-4 py-2 font-medium">Intervention</th>
                <th className="px-4 py-2 font-medium">Set</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Done</th>
                <th className="px-4 py-2 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.intervention_id} className="border-b align-top last:border-0">
                  <td className="px-4 py-2">
                    <Link href={hrefFor({ pupil: i.pupil_id })} className="font-medium hover:underline">
                      {i.pupil_name || i.pupil_id}
                    </Link>
                    {i.group_id && <div className="text-xs text-muted-foreground">{i.group_id}</div>}
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/lessons/${i.lesson_id}`} className="font-medium hover:underline">
                      {i.lesson_title}
                    </Link>
                    <div className="text-xs text-muted-foreground">{i.unit_title}</div>
                    {i.learning_objectives.length > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {i.learning_objectives.map((lo) => lo.title).join(' · ')}
                      </div>
                    )}
                    {i.reason && <div className="mt-1 text-xs italic text-muted-foreground">{i.reason}</div>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <div className="tabular-nums">{formatDay(i.set_at)}</div>
                    {i.set_by_name && <div className="text-xs text-muted-foreground">{i.set_by_name}</div>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">{formatDay(i.due_date)}</td>
                  <td className="px-4 py-2">
                    <InterventionStatusBadge status={i.status} overdue={i.overdue} />
                    {i.completed_at && (
                      <div className="mt-1 text-xs text-muted-foreground tabular-nums">{formatDay(i.completed_at)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {i.submitted_activities} / {i.scorable_activities}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatScore(i.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TeacherPageLayout>
  )
}
