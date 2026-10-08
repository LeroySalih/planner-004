import Link from 'next/link'

import { InterventionStatusBadge, formatDay, formatScore } from '@/components/interventions/status-badge'
import { readMyInterventionsAction } from '@/lib/server-actions/interventions'

export default async function MyInterventionsPage() {
  const { data, error } = await readMyInterventionsAction()

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">My Interventions</h1>
        <p className="text-sm text-muted-foreground">Lessons your teacher has set just for you.</p>
      </header>

      {error ? (
        <p className="text-sm text-destructive">Unable to load your interventions.</p>
      ) : !data || data.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          You have no interventions.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {data.map((item) => (
            <li key={item.intervention_id}>
              <Link
                href={`/pupil-lessons/${encodeURIComponent(item.pupil_id)}/lessons/${encodeURIComponent(item.lesson_id)}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-muted/50"
              >
                <div className="space-y-1">
                  <p className="font-medium">{item.lesson_title}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.unit_title}
                    {item.due_date && <> · due {formatDay(item.due_date)}</>}
                  </p>
                  <InterventionStatusBadge status={item.status} overdue={item.overdue} />
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatScore(item.score)}</p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {item.submitted_activities} of {item.scorable_activities} done
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
