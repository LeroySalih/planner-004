export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { LessonDetailClient } from "@/components/lessons/lesson-detail-client"
import {
  listLessonActivitiesAction,
  listLessonFilesAction,
  readAllLearningObjectivesAction,
  readLessonAction,
  readLessonsByUnitAction,
  readUnitAction,
} from "@/lib/server-updates"

export default async function LessonDetailPage({
  params,
}: {
  params: Promise<{ lessonId: string }>
}) {
  const { lessonId } = await params

  const lessonResult = await readLessonAction(lessonId)

  if (lessonResult.error) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="mb-4 text-2xl font-bold">Error Loading Lesson</h1>
        <p className="text-red-600">{lessonResult.error}</p>
      </div>
    )
  }

  const lesson = lessonResult.data
  if (!lesson) {
    notFound()
  }

  const [unitResult, learningObjectivesResult, lessonFilesResult, lessonActivitiesResult, lessonsByUnitResult] =
    await Promise.all([
      readUnitAction(lesson.unit_id),
      readAllLearningObjectivesAction(),
      listLessonFilesAction(lesson.lesson_id),
      listLessonActivitiesAction(lesson.lesson_id),
      readLessonsByUnitAction(lesson.unit_id),
    ])

  if (unitResult.error || learningObjectivesResult.error) {
    return (
      <div className="container mx-auto space-y-4 p-6">
        {unitResult.error && (
          <div>
            <h1 className="mb-2 text-2xl font-bold">Error Loading Unit</h1>
            <p className="text-red-600">{unitResult.error}</p>
          </div>
        )}
        {learningObjectivesResult.error && (
          <div>
            <h2 className="text-xl font-semibold">Error Loading Learning Objectives</h2>
            <p className="text-red-600">{learningObjectivesResult.error}</p>
          </div>
        )}
      </div>
    )
  }

  if (lessonFilesResult.error) {
    console.error("[v0] Failed to load lesson files:", lessonFilesResult.error)
  }

  if (lessonActivitiesResult.error) {
    console.error("[v0] Failed to load lesson activities:", lessonActivitiesResult.error)
  }

  if (lessonsByUnitResult.error) {
    console.error("[v0] Failed to load unit lessons for navigation:", lessonsByUnitResult.error)
  }

  const activities = lessonActivitiesResult.data ?? []

  const unitLessons = lessonsByUnitResult.data ?? []
  const sortedLessons = unitLessons
    .slice()
    .sort((a, b) => {
      const orderCompare = (a.order_by ?? 0) - (b.order_by ?? 0)
      if (orderCompare !== 0) {
        return orderCompare
      }
      return a.title.localeCompare(b.title)
    })

  const lessonOptions = sortedLessons.map((item) => ({
    lesson_id: item.lesson_id,
    title: item.title,
  }))

  return (
    <LessonDetailClient
      lesson={lesson}
      unit={unitResult.data ?? null}
      learningObjectives={learningObjectivesResult.data ?? []}
      lessonFiles={lessonFilesResult.data ?? []}
      lessonActivities={activities}
      unitLessons={lessonOptions}
    />
  )
}
