import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { getRevision, submitRevision } from "@/actions/revisions"
import { RevisionShortTextActivity } from "@/components/revisions/revision-short-text-activity"
import { RevisionMcqActivity } from "@/components/revisions/revision-mcq-activity"
import { RevisionUploadUrlActivity } from "@/components/revisions/revision-upload-url-activity"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export default async function RevisionPage({ params }: { params: Promise<{ revisionId: string }> }) {
  const { revisionId } = await params
  const data = await getRevision(revisionId)

  if (!data) {
    notFound()
  }

  const { revision, answers, activities, lessonTitle } = data
  const isSubmitted = revision.status === "submitted"
  const canAnswer = !isSubmitted

  // Helper map for answers
  const answerMap = new Map(answers.map(a => [a.activity_id, a]))

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
      <header className="rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-3">
          <div>
            <Link
              href={`/pupil-lessons/${revision.pupil_id}/lessons/${revision.lesson_id}`}
              className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Lesson
            </Link>
          </div>
          <div className="flex justify-between items-center">
             <h1 className="text-3xl font-semibold text-white">Revision: {lessonTitle}</h1>
             {isSubmitted && (
                 <div className="flex gap-2 items-center">
                    <span className="bg-white/20 px-3 py-1 rounded text-sm font-medium">Submitted</span>
                    <span className="bg-white text-emerald-700 px-3 py-1 rounded text-sm font-bold">
                        Score: {Math.round(answers.reduce((acc, a) => acc + (a.score || 0), 0) * 100) / 100} / {activities.length} ({activities.length > 0 ? Math.round((answers.reduce((acc, a) => acc + (a.score || 0), 0) / activities.length) * 100) : 0}%)
                    </span>
                 </div>
             )}
          </div>
          <p className="text-sm text-slate-100">Practice makes perfect. Complete the activities below.</p>
        </div>
      </header>

      <Card>
          <CardHeader>
            <CardTitle>Activities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            {activities.length === 0 ? (
                <p className="text-muted-foreground">No activities for this revision.</p>
            ) : (
                activities.map((activity, index) => {
                    const answer = answerMap.get(activity.activity_id)
                    const activityType = activity.type

                    // Props mapping
                    const commonProps = {
                        revisionId: revision.revision_id,
                        activity: activity,
                        canAnswer: canAnswer,
                        stepNumber: index + 1,
                        initialSelection: answer?.answer_data?.optionId ?? answer?.answer_data?.answer_chosen ?? null,
                        initialAnswer: answer?.answer_data?.answer ?? answer?.answer_data?.url ?? null,
                        feedbackText: isSubmitted ? answer?.feedback : null,
                        score: isSubmitted ? answer?.score : null,
                    }

                    if (activityType === 'short-text-question') {
                        return <RevisionShortTextActivity key={activity.activity_id} {...commonProps} />
                    }
                    if (activityType === 'multiple-choice-question') {
                        return <RevisionMcqActivity key={activity.activity_id} {...commonProps} />
                    }
                    if (activityType === 'upload-url') {
                        return <RevisionUploadUrlActivity key={activity.activity_id} {...commonProps} />
                    }
                    
                    // Fallback for other types
                    return (
                        <div key={activity.activity_id} className="p-4 border rounded bg-muted/20">
                            <p className="font-semibold">{activity.title}</p>
                            <p className="text-xs text-muted-foreground">Type: {activityType} (Not fully implemented in revisions yet)</p>
                        </div>
                    )
                })
            )}
          </CardContent>
      </Card>

      {!isSubmitted && (
         <div className="flex justify-end p-4 bg-card border rounded-lg shadow-sm">
            <form action={async () => {
                "use server"
                await submitRevision(revision.revision_id)
            }}>
                <Button size="lg" className="w-full sm:w-auto">Submit Revision</Button>
            </form>
         </div>
      )}
    </main>
  )
}
