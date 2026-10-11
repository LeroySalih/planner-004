import Link from 'next/link'

import { cn } from '@/lib/utils'
import type { AssessmentGrid } from '@/types'

import { averageBandClass, percentOf, pupilName, SCORE_BAND_CLASSES, scoreBand } from './format'

const STICKY = 'sticky left-0 z-10 bg-card'

/**
 * Pupils x questions, then total and per-objective columns.
 *
 * A missing answer is 0 marks. For a pupil with a result, a question with no
 * mark shows as a red 0 and counts as 0 everywhere: in their total (every
 * question is in the denominator) and in the class averages. Pupils with no
 * result at all are listed but left out of the averages until they have one.
 * Off-roster ("left group") pupils who sat the paper are included: they sat it.
 */
export function ResultsGrid({ paper }: { paper: AssessmentGrid }) {
  const sat = paper.pupils.filter((p) => p.has_result)
  const questionAverage = (label: string, max: number) => {
    if (sat.length === 0) return null
    const awarded = sat.reduce((sum, p) => sum + (p.marks[label]?.awarded ?? 0), 0)
    return percentOf(awarded, sat.length * max)
  }
  const meanPercent = (scopes: { awarded: number; available: number }[]) => {
    const scored = scopes.filter((s) => s.available > 0)
    if (scored.length === 0) return null
    return Math.round(scored.reduce((sum, s) => sum + (s.awarded / s.available) * 100, 0) / scored.length)
  }
  const totalAverage = meanPercent(sat.map((p) => ({ awarded: p.total_awarded, available: p.total_available })))
  const objectiveAverage = (code: string) =>
    meanPercent(sat.map((p) => p.objectives.find((s) => s.code === code) ?? { awarded: 0, available: 0 }))

  return (
    <div className="space-y-3">
      <Legend />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-xs">
              <th className={cn(STICKY, 'z-20 min-w-44 border-b border-r px-3 py-2 text-left font-medium')}>Pupil</th>
              {paper.questions.map((q) => (
                <th key={q.label} className="border-b px-1.5 py-2 text-center font-medium whitespace-nowrap">
                  <div>{q.label}</div>
                  <div className="font-normal text-muted-foreground">/{q.max_marks} · {q.objective_code}</div>
                </th>
              ))}
              <th className="border-b border-l px-3 py-2 text-center font-medium">
                Total
                <div className="font-normal text-muted-foreground">/{paper.total_marks}</div>
              </th>
              {paper.objectives.map((o) => (
                <th key={o.code} className="border-b border-l px-3 py-2 text-center font-medium">{o.code}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paper.pupils.map((pupil) => (
              <tr key={pupil.pupil_id} className={cn(!pupil.has_result && 'text-muted-foreground')}>
                <th className={cn(STICKY, 'border-b border-r px-3 py-1.5 text-left font-normal whitespace-nowrap')}>
                  <Link
                    href={`/assessments/${paper.assessment_id}/pupils/${pupil.pupil_id}`}
                    className="hover:underline"
                  >
                    {pupil.last_name && pupil.first_name ? `${pupil.last_name}, ${pupil.first_name}` : pupilName(pupil)}
                  </Link>
                  {!pupil.has_result && <span className="ml-2 text-xs italic">no result</span>}
                  {!pupil.on_roster && <span className="ml-2 text-xs italic">left group</span>}
                </th>
                {paper.questions.map((q) => {
                  const mark = pupil.marks[q.label]
                  // No mark on a pupil with a result is a missing answer: 0.
                  const missing = !mark && pupil.has_result
                  return (
                    <td
                      key={q.label}
                      className={cn(
                        'relative border-b px-1.5 py-1.5 text-center tabular-nums',
                        mark
                          ? SCORE_BAND_CLASSES[scoreBand(mark.awarded, q.max_marks)]
                          : missing ? SCORE_BAND_CLASSES.zero : 'bg-muted/40',
                      )}
                      title={mark?.provenance === 'teacher' ? 'Edited by a teacher' : missing ? 'No answer: 0 marks' : undefined}
                    >
                      {mark ? mark.awarded : missing ? 0 : ''}
                      {mark?.provenance === 'teacher' && (
                        <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-sky-600" aria-label="teacher edited" />
                      )}
                    </td>
                  )
                })}
                <td className="border-b border-l px-3 py-1.5 text-center font-medium whitespace-nowrap tabular-nums">
                  {pupil.marked_questions === 0 ? (
                    <span className="text-xs italic">Not marked yet</span>
                  ) : (
                    <>{pupil.total_awarded} / {pupil.total_available} · {pupil.percent}%</>
                  )}
                </td>
                {pupil.objectives.map((o) => (
                  <td key={o.code} className="border-b border-l px-3 py-1.5 text-center whitespace-nowrap tabular-nums">
                    {o.available > 0 ? `${o.awarded}/${o.available} (${percentOf(o.awarded, o.available)}%)` : '–'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-xs font-medium">
              <th className={cn(STICKY, 'border-r px-3 py-2 text-left')}>Class average</th>
              {paper.questions.map((q) => {
                const avg = questionAverage(q.label, q.max_marks)
                return (
                  <td key={q.label} className={cn('px-1.5 py-2 text-center tabular-nums', avg !== null && averageBandClass(avg))}>
                    {avg === null ? '–' : `${avg}%`}
                  </td>
                )
              })}
              <AverageCell value={totalAverage} />
              {paper.objectives.map((o) => (
                <AverageCell key={o.code} value={objectiveAverage(o.code)} />
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function AverageCell({ value }: { value: number | null }) {
  return (
    <td className={cn('border-l px-3 py-2 text-center tabular-nums', value !== null && averageBandClass(value))}>
      {value === null ? '–' : `${value}%`}
    </td>
  )
}

function Legend() {
  const items = [
    { label: 'Full marks', className: SCORE_BAND_CLASSES.full },
    { label: 'Some marks', className: SCORE_BAND_CLASSES.partial },
    { label: 'No marks or no answer', className: SCORE_BAND_CLASSES.zero },
    { label: 'No result', className: 'bg-muted/40' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={cn('inline-block size-3 rounded-sm border', item.className)} />
          {item.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-1.5 rounded-full bg-sky-600" />
        Edited by a teacher
      </span>
      <span>Class average: green ≥ 70%, amber ≥ 40%, red below</span>
    </div>
  )
}
