import { notFound } from "next/navigation"

import { LessonActivityPresentationClient } from "@/components/lessons/lesson-activity-presentation-client"
import type { LessonFileInfo, LessonLinkInfo } from "@/components/units/lesson-sidebar"
import {
  listActivityFilesAction,
  listLessonActivitiesAction,
  listLessonFilesAction,
  readLessonAction,
  readUnitAction,
} from "@/lib/server-updates"

export default async function LessonActivityPresentationPage({
  params,
}: {
  params: Promise<{ lessonId: string; activityId: string }>
}) {
  const { lessonId, activityId } = await params

  const lessonResult = await readLessonAction(lessonId)

  if (lessonResult.error) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <h1 className="text-2xl font-semibold text-destructive">Unable to load lesson</h1>
        <p className="text-sm text-destructive/80">{lessonResult.error}</p>
      </div>
    )
  }

  const lesson = lessonResult.data
  if (!lesson) {
    notFound()
  }

  const activitiesResult = await listLessonActivitiesAction(lesson.lesson_id)

  if (activitiesResult.error) {
    console.error("[activities] Failed to load activities for presentation:", activitiesResult.error)
  }

  const activities = activitiesResult.data ?? []
  const hasActivity = activities.some((activity) => activity.activity_id === activityId)

  if (!hasActivity) {
    notFound()
  }

  const [unitResult, lessonFilesResult] = await Promise.all([
    readUnitAction(lesson.unit_id),
    listLessonFilesAction(lesson.lesson_id),
  ])

  if (unitResult.error) {
    console.error("[activities] Failed to load unit for presentation:", unitResult.error)
  }

  if (lessonFilesResult.error) {
    console.error("[activities] Failed to load lesson files for presentation:", lessonFilesResult.error)
  }

  const activityFilesEntries = await Promise.all(
    activities.map(async (activity) => {
      const result = await listActivityFilesAction(lesson.lesson_id, activity.activity_id)
      if (result.error) {
        console.error(
          "[activities] Failed to load activity files for presentation:",
          activity.activity_id,
          result.error,
        )
      }
      return [activity.activity_id, result.data ?? []] as const
    }),
  )

  const activityFilesMap = activityFilesEntries.reduce<Record<string, LessonFileInfo[]>>((acc, [id, files]) => {
    acc[id] = files
    return acc
  }, {})

  const unitTitle = unitResult.data?.title ?? lesson.unit_id
  const lessonFiles = lessonFilesResult.data ?? []
  const lessonLinks = (lesson.lesson_links ?? []) as LessonLinkInfo[]
  const lessonObjectives = lesson.lesson_objectives

  return (
    <LessonActivityPresentationClient
      lessonId={lesson.lesson_id}
      lessonTitle={lesson.title}
      unitTitle={unitTitle}
      activities={activities}
      activityFilesMap={activityFilesMap}
      lessonFiles={lessonFiles}
      lessonLinks={lessonLinks}
      lessonObjectives={lessonObjectives}
      currentActivityId={activityId}
    />
  )
}
