import Link from 'next/link'
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react'

import { pupilName } from '@/components/assessments/format'
import { PupilFeedbackEditor } from '@/components/assessments/pupil-feedback-editor'
import { TeacherPageLayout } from '@/components/layouts/TeacherPageLayout'
import { Button } from '@/components/ui/button'
import { readAssessmentPupilAction } from '@/lib/server-updates'

type PageProps = {
  params: Promise<{ assessmentId: string; pupilId: string }>
}

export default async function AssessmentPupilPage({ params }: PageProps) {
  const { assessmentId, pupilId } = await params
  const { data, error } = await readAssessmentPupilAction(assessmentId, pupilId)

  if (!data) {
    return (
      <TeacherPageLayout title="Pupil result" breadcrumbs={[{ label: 'Assessments', href: '/assessments' }, { label: 'Not found' }]}>
        <p className="text-sm text-destructive">{error ?? 'Result not found'}</p>
      </TeacherPageLayout>
    )
  }

  const { result, objectives, previous, next, onRoster, files } = data
  const base = `/assessments/${result.assessment.assessment_id}`

  return (
    <TeacherPageLayout
      maxWidth="5xl"
      title={pupilName(result)}
      subtitle={result.assessment.feedback_visible ? 'Feedback released: the pupil can see this page.' : 'Feedback not released: the pupil cannot see this yet.'}
      breadcrumbs={[
        { label: 'Assessments', href: '/assessments' },
        { label: result.assessment.title, href: base },
        { label: pupilName(result) },
      ]}
      headerAction={
        <div className="flex gap-2">
          {previous ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`${base}/pupils/${previous.pupil_id}`}><ChevronLeft /> {pupilName(previous)}</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled><ChevronLeft /> Previous</Button>
          )}
          {next ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`${base}/pupils/${next.pupil_id}`}>{pupilName(next)} <ChevronRight /></Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Next <ChevronRight /></Button>
          )}
        </div>
      }
    >
      {!onRoster && (
        <p className="text-sm text-muted-foreground">
          This pupil is no longer in the paper&apos;s groups, so the result is read-only.
        </p>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {files.map((file) => (
            <a
              key={file.file_name}
              href={file.path}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              <FileText className="size-4" />
              {file.file_name}
            </a>
          ))}
        </div>
      )}
      <PupilFeedbackEditor key={result.pupil_id} result={result} objectives={objectives} editable={onRoster} />
    </TeacherPageLayout>
  )
}
