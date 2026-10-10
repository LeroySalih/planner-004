import Link from 'next/link'

import { AssessmentRowMenu } from '@/components/assessments/assessment-row-menu'
import { AssessmentGroupFilter } from '@/components/assessments/group-filter'
import { formatAssessmentDate } from '@/components/assessments/format'
import { TeacherPageLayout } from '@/components/layouts/TeacherPageLayout'
import { Badge } from '@/components/ui/badge'
import { readAssessmentsAction } from '@/lib/server-updates'

type PageProps = {
  searchParams: Promise<{ group?: string }>
}

export default async function AssessmentsPage({ searchParams }: PageProps) {
  const { group } = await searchParams
  const groupId = group?.trim() || null
  const { data, error } = await readAssessmentsAction(groupId)

  return (
    <TeacherPageLayout
      title="Assessments"
      subtitle="Written papers marked outside lessons. Pupils see nothing until you release a paper's feedback."
      headerAction={data && data.groupIds.length > 0 && <AssessmentGroupFilter groupIds={data.groupIds} value={groupId} />}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && data.assessments.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {groupId ? `No assessment papers for ${groupId}.` : 'No assessment papers yet.'}
        </p>
      )}
      {data && data.assessments.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Paper</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Groups</th>
                <th className="px-4 py-2 text-right font-medium">Questions</th>
                <th className="px-4 py-2 text-right font-medium">Marks</th>
                <th className="px-4 py-2 text-right font-medium">Pupils with results</th>
                <th className="px-4 py-2 font-medium">Feedback</th>
                <th className="w-12 px-2 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.assessments.map((paper) => (
                <tr key={paper.assessment_id} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/assessments/${paper.assessment_id}`} className="font-medium hover:underline">
                      {paper.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {paper.curriculum_title}
                      {paper.unlinked_objective_count > 0 && (
                        <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
                          {paper.unlinked_objective_count} {paper.unlinked_objective_count === 1 ? 'objective' : 'objectives'} not linked
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">{formatAssessmentDate(paper.assessed_on)}</td>
                  <td className="px-4 py-2">{paper.group_ids.join(', ')}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{paper.question_count}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{paper.total_marks}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{paper.pupils_with_results}</td>
                  <td className="px-4 py-2">
                    {paper.feedback_visible ? (
                      <Badge className="bg-emerald-600 text-white">Released</Badge>
                    ) : (
                      <Badge variant="secondary">Not released</Badge>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <AssessmentRowMenu assessmentId={paper.assessment_id} title={paper.title} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TeacherPageLayout>
  )
}
