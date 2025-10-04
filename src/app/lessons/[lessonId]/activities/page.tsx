import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { LessonActivity } from "@/types"
import {
  getActivityFileDownloadUrlAction,
  listActivityFilesAction,
  listLessonActivitiesAction,
  readLessonAction,
  readUnitAction,
} from "@/lib/server-updates"

interface ActivityPreview {
  activity: LessonActivity & { orderIndex: number }
  textContent: string | null
  imageUrl: string | null
}

function extractActivityText(activity: LessonActivity): string | null {
  if (typeof activity.body_data !== "object" || activity.body_data === null) {
    return null
  }

  const record = activity.body_data as Record<string, unknown>
  const candidateKeys = ["text", "instructions", "prompt", "question", "body", "description"]

  for (const key of candidateKeys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function extractImageDescriptor(activity: LessonActivity): { url: string | null; fileName: string | null } {
  if (activity.type !== "display-image") {
    return { url: null, fileName: null }
  }

  if (typeof activity.body_data !== "object" || activity.body_data === null) {
    return { url: null, fileName: null }
  }

  const record = activity.body_data as Record<string, unknown>
  const url = typeof record.imageUrl === "string" && record.imageUrl.trim().length > 0 ? record.imageUrl : null
  const fileName =
    typeof record.imageFile === "string" && record.imageFile.trim().length > 0 ? record.imageFile : null

  return { url, fileName }
}

async function resolveActivityImageUrl(
  lessonId: string,
  activity: LessonActivity,
): Promise<string | null> {
  const { url, fileName } = extractImageDescriptor(activity)
  if (url) {
    return url
  }

  if (activity.type !== "display-image") {
    return null
  }

  const candidateFileName = fileName ?? (await fetchFirstActivityFileName(lessonId, activity.activity_id))
  if (!candidateFileName) {
    return null
  }

  try {
    const result = await getActivityFileDownloadUrlAction(lessonId, activity.activity_id, candidateFileName)
    if (!result.success || !result.url) {
      console.error("[activities] Failed to create signed image URL", result.error)
      return null
    }
    return result.url
  } catch (error) {
    console.error("[activities] Unexpected error resolving image URL", error)
    return null
  }
}

async function fetchFirstActivityFileName(lessonId: string, activityId: string): Promise<string | null> {
  try {
    const filesResult = await listActivityFilesAction(lessonId, activityId)
    if (filesResult.error) {
      console.error("[activities] Failed to list activity files:", filesResult.error)
      return null
    }
    const firstFile = filesResult.data?.[0]
    return firstFile?.name ?? null
  } catch (error) {
    console.error("[activities] Unexpected error listing activity files", error)
    return null
  }
}

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

  const activitiesWithPreview: ActivityPreview[] = await Promise.all(
    orderedActivities.map(async (activity) => {
      const textContent = extractActivityText(activity)
      const imageUrl = await resolveActivityImageUrl(lesson.lesson_id, activity)
      return { activity, textContent, imageUrl }
    }),
  )

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
              {activitiesWithPreview.map(({ activity, textContent, imageUrl }) => {
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
                            {activity.is_homework ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                                Homework
                              </span>
                            ) : null}
                          </div>

                          {textContent ? (
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                              {textContent}
                            </p>
                          ) : null}

                          {imageUrl ? (
                            <div className="overflow-hidden rounded-lg border border-border">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={imageUrl}
                                alt={displayTitle}
                                className="h-auto w-full max-h-[320px] object-cover"
                                loading="lazy"
                              />
                            </div>
                          ) : null}
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
