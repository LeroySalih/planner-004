export const dynamic = "force-dynamic"

import { redirect, notFound } from "next/navigation"
import { LessonDetailClient } from "@/components/lessons/lesson-detail-client"
import { PublicLessonView } from "@/components/public/PublicLessonView"
import { PublicLessonNav } from "@/components/public/PublicLessonNav"
import {
  readActiveMarkingGuidancesForSubjectAction,
  readAllLearningObjectivesAction,
  readLessonDetailBootstrapAction,
  readLessonReferenceDataAction,
  readPublicLessonActivitiesAction,
} from "@/lib/server-updates"
import { getAuthenticatedProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"

export default async function LessonDetailPage({
  params,
}: {
  params: Promise<{ lessonId: string }>
}) {
  const { lessonId } = await params

  const profile = await getAuthenticatedProfile()

  if (!profile) {
    // Unauthenticated: check if lesson is public
    const publicResult = await readPublicLessonActivitiesAction(lessonId)

    if (publicResult.error || !publicResult.data) {
      // Not public or not found — redirect to sign-in
      redirect(`/signin?returnTo=/lessons/${lessonId}`)
    }

    // Public lesson — fetch breadcrumb info from bootstrap (no auth required)
    const lessonDetailResult = await readLessonDetailBootstrapAction(lessonId)
    const lesson = lessonDetailResult.data?.lesson
    if (!lesson) {
      notFound()
    }

    const referenceResult = await readLessonReferenceDataAction(lessonId)
    const curriculum = referenceResult.data?.curricula?.[0]

    return (
      <div className="flex flex-col min-h-screen">
        <PublicLessonNav />
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
          {/* Breadcrumb */}
          <p className="mb-2 text-xs text-muted-foreground">
            {curriculum?.title ? `${curriculum.title} › ` : ""}
            {lessonDetailResult.data?.unit?.title ?? ""}
          </p>
          <h1 className="mb-8 text-3xl font-bold text-foreground">{lesson.title}</h1>

          <PublicLessonView
            activities={publicResult.data}
            lessonId={lessonId}
          />

          {/* Bottom sign-in nudge */}
          <div className="mt-12 flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-6 py-5">
            <div>
              <p className="font-semibold text-foreground">Continue learning with Dino</p>
              <p className="text-sm text-muted-foreground">
                Attempt activities, track your progress, and access all lessons.
              </p>
            </div>
            <a
              href="/signin"
              className="flex-shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Sign in →
            </a>
          </div>
        </main>
      </div>
    )
  }

  // Authenticated: existing full lesson flow unchanged
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

  const learningObjectivesResult = await readAllLearningObjectivesAction({
    routeTag: "/lessons/[lessonId]",
    authEndTime: authEnd,
    curriculumIds,
    unitId: lesson.unit_id,
  })

  const lessonSubject = lessonPayload?.unit?.subject ?? null
  const markingGuidancesResult = lessonSubject
    ? await readActiveMarkingGuidancesForSubjectAction(lessonSubject)
    : { data: [], error: null }

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
    if (orderCompare !== 0) return orderCompare
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
      unitLessons={lessonOptions}
      availableMarkingGuidances={markingGuidancesResult.data ?? []}
      viewerUserId={profile.userId}
    />
  )
}
