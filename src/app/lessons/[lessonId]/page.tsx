export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { LessonDetailClient } from "@/components/lessons/lesson-detail-client"
import {
  listLessonSubmissionFilesAction,
  readAllLearningObjectivesAction,
  readLessonDetailBootstrapAction,
  readLessonReferenceDataAction,
} from "@/lib/server-updates"
import { withTelemetry } from "@/lib/telemetry"

export default async function LessonDetailPage({
  params,
}: {
  params: Promise<{ lessonId: string }>
}) {
  const { lessonId } = await params
  const authEnd: number | null = null

  const lessonDetailResult = await withTelemetry(
    {
      routeTag: "/lessons/[lessonId]",
      functionName: "LessonDetailPage.lessonBootstrap",
      params: { lessonId },
      authEndTime: authEnd,
    },
    () =>
      readLessonDetailBootstrapAction(lessonId, {
        routeTag: "/lessons/[lessonId]",
        authEndTime: authEnd,
      }),
  )

  if (lessonDetailResult.error) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="mb-4 text-2xl font-bold">Error Loading Lesson</h1>
        <p className="text-red-600">{lessonDetailResult.error}</p>
      </div>
    )
  }

  const lessonPayload = lessonDetailResult.data
  const lesson = lessonPayload?.lesson
  if (!lesson) {
    notFound()
  }

  const referenceResult = await withTelemetry(
    {
      routeTag: "/lessons/[lessonId]",
      functionName: "LessonDetailPage.loadReferenceData",
      params: { lessonId, unitId: lesson.unit_id },
      authEndTime: authEnd,
    },
    () =>
      readLessonReferenceDataAction(lesson.lesson_id, {
        routeTag: "/lessons/[lessonId]",
        authEndTime: authEnd,
      }),
  )

  const curriculumIds =
    referenceResult.data?.curricula?.map((c) => c.curriculum_id).filter((id): id is string => Boolean(id)) ?? []

  const [learningObjectivesResult, submissionFilesResult] = await Promise.all([
    readAllLearningObjectivesAction({
      routeTag: "/lessons/[lessonId]",
      authEndTime: authEnd,
      curriculumIds,
      unitId: lesson.unit_id,
    }),
    listLessonSubmissionFilesAction(lessonId),
  ])

  if (referenceResult.error || learningObjectivesResult.error) {
    return (
      <div className="container mx-auto space-y-4 p-6">
        {referenceResult.error && (
          <div>
            <h2 className="text-xl font-semibold">Error Loading Curricula or Assessment Objectives</h2>
            <p className="text-red-600">{referenceResult.error}</p>
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

  const unitLessons = (lessonPayload?.unitLessons ?? []).slice().sort((a, b) => {
    const orderCompare = (a.order_by ?? 0) - (b.order_by ?? 0)
    if (orderCompare !== 0) {
      return orderCompare
    }
    return a.title.localeCompare(b.title)
  })

  const lessonOptions = unitLessons.map((item) => ({
    lesson_id: item.lesson_id,
    title: item.title,
  }))

  const allowedCurriculumIds = new Set(
    (referenceResult.data?.curricula ?? [])
      .map((curriculum) => curriculum.curriculum_id)
      .filter((id): id is string => Boolean(id)),
  )

  const curriculumLearningObjectives =
    allowedCurriculumIds.size === 0
      ? learningObjectivesResult.data ?? []
      : (learningObjectivesResult.data ?? []).filter((objective) => {
          const curriculumId =
            objective.assessment_objective_curriculum_id ??
            objective.assessment_objective?.curriculum_id ??
            null
          return curriculumId ? allowedCurriculumIds.has(curriculumId) : false
        })

  return (
    <LessonDetailClient
      lesson={lesson}
      unit={lessonPayload?.unit ?? null}
      learningObjectives={curriculumLearningObjectives}
      curricula={referenceResult.data?.curricula ?? []}
      assessmentObjectives={referenceResult.data?.assessmentObjectives ?? []}
      lessonFiles={lessonPayload?.lessonFiles ?? []}
      lessonActivities={lessonPayload?.lessonActivities ?? []}
      activityFiles={submissionFilesResult.data ?? []}
      unitLessons={lessonOptions}
    />
  )
}
