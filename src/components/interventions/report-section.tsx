import { InterventionStatusBadge, formatDay, formatScore } from '@/components/interventions/status-badge'
import { readInterventions } from '@/lib/interventions/store'

/**
 * A pupil's interventions on their report. Kept apart from the subject
 * sections on purpose: intervention scores never feed LO results or class
 * averages. Shown to the pupil too, so it carries no teacher notes.
 */
export async function InterventionReportSection({ pupilId }: { pupilId: string }) {
  const interventions = await readInterventions({ pupilId, statuses: ['assigned', 'in_progress', 'completed'] })
  if (interventions.length === 0) return null

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <header>
        <h2 className="text-xl font-semibold text-foreground">Interventions</h2>
        <p className="text-sm text-muted-foreground">Extra lessons set for this pupil. Scored separately from class work.</p>
      </header>
      <ul className="divide-y">
        {interventions.map((i) => (
          <li key={i.intervention_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="space-y-1">
              <p className="font-medium">{i.lesson_title}</p>
              <p className="text-xs text-muted-foreground">
                {i.unit_title} · set {formatDay(i.set_at)}
                {i.due_date && <> · due {formatDay(i.due_date)}</>}
              </p>
              {i.learning_objectives.length > 0 && (
                <p className="text-xs text-muted-foreground">{i.learning_objectives.map((lo) => lo.title).join(' · ')}</p>
              )}
              <InterventionStatusBadge status={i.status} overdue={i.overdue} />
            </div>
            <div className="text-right">
              <p className="font-semibold tabular-nums">{formatScore(i.score)}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {i.submitted_activities} of {i.scorable_activities} done
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
