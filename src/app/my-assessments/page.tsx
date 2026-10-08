import Link from 'next/link'

import { formatAssessmentDate } from '@/components/assessments/format'
import { readMyAssessmentsAction } from '@/lib/server-updates'

export default async function MyAssessmentsPage() {
  const { data, error } = await readMyAssessmentsAction()

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">My Assessments</h1>
        <p className="text-sm text-muted-foreground">Feedback on the papers you have sat.</p>
      </header>

      {error ? (
        <p className="text-sm text-destructive">Unable to load your assessments.</p>
      ) : !data || data.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No assessment feedback has been released to you yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {data.map((paper) => (
            <li key={paper.assessment_id}>
              <Link
                href={`/my-assessments/${paper.assessment_id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-muted/50"
              >
                <div>
                  <p className="font-medium">{paper.title}</p>
                  <p className="text-sm text-muted-foreground">{formatAssessmentDate(paper.assessed_on)}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">
                    {paper.total_awarded} / {paper.total_available} · {paper.percent}%
                  </p>
                  {paper.marked_questions < paper.question_count && (
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {paper.marked_questions} of {paper.question_count} questions marked
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
