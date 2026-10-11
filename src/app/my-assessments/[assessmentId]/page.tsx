import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, FileText } from 'lucide-react'

import { PupilFeedbackView } from '@/components/assessments/pupil-feedback-view'
import { readMyAssessmentAction } from '@/lib/server-updates'

type PageProps = {
  params: Promise<{ assessmentId: string }>
}

export default async function MyAssessmentPage({ params }: PageProps) {
  const { assessmentId } = await params
  const { data, error } = await readMyAssessmentAction(assessmentId)

  if (!data && !error) notFound()

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <Link href="/my-assessments" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> My Assessments
      </Link>
      {data ? (
        <>
          <PupilFeedbackView result={data.result} objectives={data.objectives} />
          {data.scripts.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Your marked paper</h2>
              <div className="flex flex-wrap gap-3">
                {data.scripts.map((script) => (
                  <a
                    key={script.file_name}
                    href={script.path}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    <FileText className="size-4" />
                    {script.file_name}
                  </a>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <p className="text-sm text-destructive">Unable to load this assessment.</p>
      )}
    </main>
  )
}
