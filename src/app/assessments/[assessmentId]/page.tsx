import { FileText, UserRound } from 'lucide-react'

import { AssessmentFilesButton } from '@/components/assessments/assessment-files-button'
import { FeedbackReleaseSwitch } from '@/components/assessments/feedback-release-switch'
import { formatAssessmentDate } from '@/components/assessments/format'
import { ObjectiveLinksPanel } from '@/components/assessments/objective-links-panel'
import { ResultsGrid } from '@/components/assessments/results-grid'
import { TeacherPageLayout } from '@/components/layouts/TeacherPageLayout'
import { readAssessmentAction } from '@/lib/server-updates'

type PageProps = {
  params: Promise<{ assessmentId: string }>
}

export default async function AssessmentPage({ params }: PageProps) {
  const { assessmentId } = await params
  const { data, error } = await readAssessmentAction(assessmentId)

  if (!data) {
    return (
      <TeacherPageLayout title="Assessment" breadcrumbs={[{ label: 'Assessments', href: '/assessments' }, { label: 'Not found' }]}>
        <p className="text-sm text-destructive">{error ?? 'Assessment not found'}</p>
      </TeacherPageLayout>
    )
  }

  const { paper, files, linkableObjectives } = data
  const withResults = paper.pupils.filter((p) => p.has_result).length

  return (
    <TeacherPageLayout
      maxWidth="full"
      title={paper.title}
      subtitle={`${formatAssessmentDate(paper.assessed_on)} · ${paper.group_ids.join(', ')} · ${paper.curriculum_title} · ${paper.questions.length} questions · ${paper.total_marks} marks · ${withResults} of ${paper.pupils.length} pupils with results`}
      breadcrumbs={[{ label: 'Assessments', href: '/assessments' }, { label: paper.title }]}
      headerAction={
        <div className="flex items-center gap-3">
          <AssessmentFilesButton assessmentId={paper.assessment_id} title={paper.title} />
          <FeedbackReleaseSwitch assessmentId={paper.assessment_id} visible={paper.feedback_visible} />
        </div>
      }
    >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {files.map((file) => (
            <a
              key={file.file_name}
              href={file.path}
              title={file.pupil_id ? 'Linked to a pupil' : 'Whole paper (teachers only)'}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              {file.pupil_id ? <UserRound className="size-4" /> : <FileText className="size-4" />}
              {file.file_name}
            </a>
          ))}
        </div>
      )}

      <ObjectiveLinksPanel
        assessmentId={paper.assessment_id}
        curriculumTitle={paper.curriculum_title}
        objectives={paper.objectives}
        linkable={linkableObjectives}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Results</h2>
        {paper.questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">This paper has no questions yet.</p>
        ) : (
          <ResultsGrid paper={paper} />
        )}
      </section>
    </TeacherPageLayout>
  )
}
