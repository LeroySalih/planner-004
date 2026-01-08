import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ChevronRight } from "lucide-react"

import { LessonActivityView } from "@/components/lessons/activity-view"
import { Button } from "@/components/ui/button"
import { resolveActivityAssets } from "@/lib/activity-assets"
import { listLessonActivitiesAction, readLessonAction, readUnitAction } from "@/lib/server-updates"

export default async function LessonActivitiesOverviewPage({
  params,
}: {
  params: Promise<{ lessonId: string }>
}) {
  const { lessonId } = await params

  const lessonResult = await readLessonAction(lessonId)

  if (lessonResult.error) {
    return (
      <div className="container mx-auto space-y-6 px-6 py-10">
        <Button asChild variant="outline" className="w-fit">
          <Link href={`/lessons/${encodeURIComponent(lessonId)}`}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to lesson
          </Link>
        </Button>
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6">
          <h1 className="text-xl font-semibold text-destructive">Unable to load lesson</h1>
          <p className="mt-2 text-sm text-destructive/80">{lessonResult.error}</p>
        </div>
      </div>
    )
  }

  const lesson = lessonResult.data
  if (!lesson) {
    notFound()
  }

  const [unitResult, activitiesResult] = await Promise.all([
    readUnitAction(lesson.unit_id),
    listLessonActivitiesAction(lesson.lesson_id),
  ])

  if (unitResult.error) {
    console.error("[activities] Failed to load unit for activities overview:", unitResult.error)
  }

  if (activitiesResult.error) {
    console.error("[activities] Failed to load activities for overview:", activitiesResult.error)
  }

  const orderedActivities = (activitiesResult.data ?? []).map((activity, index) => ({
    ...activity,
    orderIndex: index,
  }))

  const { activitiesWithPreview } = await resolveActivityAssets(lesson.lesson_id, orderedActivities)

  const unitTitle = unitResult.data?.title ?? lesson.unit_id

  const objectives = (lesson.lesson_objectives ?? []).map((objective) => {
    const title = objective.learning_objective?.title ?? objective.title
    const successCriteria = objective.learning_objective?.success_criteria ?? []
    return {
      id: objective.learning_objective_id,
      title,
      successCriteria,
    }
  })

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-blue-600 text-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-white/70">Unit</p>
              <p className="text-2xl font-semibold leading-tight">{unitTitle}</p>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-white/70">Lesson</p>
                <h1 className="text-3xl font-bold leading-tight">{lesson.title}</h1>
              </div>
            </div>
            <Button
              asChild
              variant="secondary"
              className="bg-white/10 text-white shadow-sm hover:bg-white/20"
            >
              <Link href={`/lessons/${encodeURIComponent(lesson.lesson_id)}`}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to lesson
              </Link>
            </Button>
          </div>
          <p className="text-sm text-white/80">
            Review every planned activity, then jump straight into presentation mode when you&apos;re ready to teach.
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-8">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Learning objectives &amp; success criteria</h2>
          {objectives.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              No learning objectives are linked to this lesson yet.
            </p>
          ) : (
            <ul className="space-y-4">
              {objectives.map((objective) => (
                <li key={objective.id} className="rounded-lg border border-border bg-card/60 p-4 shadow-sm">
                  <p className="text-base font-semibold text-foreground">{objective.title}</p>
                  {objective.successCriteria && objective.successCriteria.length > 0 ? (
                    <ul className="mt-3 space-y-2 border-l border-border/60 pl-4 text-sm text-muted-foreground">
                      {objective.successCriteria.map((criterion) => (
                        <li key={criterion.success_criteria_id}>
                          <span className="font-medium text-foreground">Level {criterion.level}:</span>{" "}
                          {criterion.description}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">No success criteria recorded yet.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-foreground">Activities</h2>
            <span className="text-sm text-muted-foreground">
              {orderedActivities.length} {orderedActivities.length === 1 ? "activity" : "activities"}
            </span>
          </div>

          {orderedActivities.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
              No activities have been added to this lesson yet.
            </div>
          ) : (
            <ul className="space-y-4">
              {activitiesWithPreview.map(({ activity, imageUrl }) => {
                const stepNumber = activity.orderIndex + 1
                const displayTitle = activity.title?.trim().length ? activity.title : `Activity ${stepNumber}`

                return (
                  <li key={activity.activity_id}>
                    <Link
                      href={`/lessons/${encodeURIComponent(lesson.lesson_id)}/activities/activity/${encodeURIComponent(activity.activity_id)}`}
                      className="group block rounded-xl border border-border bg-card/60 px-5 py-5 transition hover:border-primary/60 hover:bg-card"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex flex-1 flex-col gap-4">
                          <div className="flex flex-wrap items-baseline gap-3">
                            <span className="text-4xl font-extrabold text-primary">{stepNumber}</span>
                            <span className="text-xl font-semibold text-foreground">{displayTitle}</span>
                          </div>

                          <LessonActivityView
                            mode="short"
                            activity={activity}
                            lessonId={lesson.lesson_id}
                            resolvedImageUrl={imageUrl}
                          />
                        </div>
                        <ChevronRight className="mt-2 h-5 w-5 shrink-0 text-muted-foreground transition group-hover:text-primary" />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
