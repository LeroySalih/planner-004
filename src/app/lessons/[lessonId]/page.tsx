export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { LessonDetailClient } from "@/components/lessons/lesson-detail-client"
import {
  listLessonFilesAction,
  readLearningObjectivesByUnitAction,
  readLessonAction,
  readUnitAction,
} from "@/lib/server-updates"

export default async function LessonDetailPage({
  params,
}: {
  params: { lessonId: string }
}) {
  const lessonResult = await readLessonAction(params.lessonId)

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

  const [unitResult, learningObjectivesResult, lessonFilesResult] = await Promise.all([
    readUnitAction(lesson.unit_id),
    readLearningObjectivesByUnitAction(lesson.unit_id),
    listLessonFilesAction(lesson.lesson_id),
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

  return (
    <LessonDetailClient
      lesson={lesson}
      unit={unitResult.data ?? null}
      learningObjectives={learningObjectivesResult.data ?? []}
      lessonFiles={lessonFilesResult.data ?? []}
    />
  )
}
