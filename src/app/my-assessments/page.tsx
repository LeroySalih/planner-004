import Link from 'next/link'

import { formatAssessmentDate } from '@/components/assessments/format'
import { PupilPicker } from '@/components/pupil-picker'
import { requireAuthenticatedProfile } from '@/lib/auth'
import { loadPupilPicker, viewedPupilId } from '@/lib/pupil-picker'
import { readMyAssessmentsAction } from '@/lib/server-updates'

type PageProps = {
  searchParams: Promise<{ pupil?: string; group?: string }>
}

export default async function MyAssessmentsPage({ searchParams }: PageProps) {
  const profile = await requireAuthenticatedProfile()
  const { pupil, group } = await searchParams
  // Admins may view the page as any pupil (?pupil=); everyone else sees their own.
  const pupilId = viewedPupilId(profile, pupil)
  const [{ data, error }, picker] = await Promise.all([
    readMyAssessmentsAction(pupilId),
    loadPupilPicker(profile, pupilId, group),
  ])
  // Keep the chosen pupil when opening a paper.
  const viewQuery = pupilId === profile.userId
    ? ''
    : `?${new URLSearchParams({ pupil: pupilId, ...(group ? { group } : {}) }).toString()}`

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
      {picker && <PupilPicker {...picker} basePath="/my-assessments" pupilIn="query" />}
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
                href={`/my-assessments/${paper.assessment_id}${viewQuery}`}
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
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
