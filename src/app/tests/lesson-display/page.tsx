import { query } from "@/lib/db"
import { readLessonDetailBootstrapAction } from "@/lib/server-updates"
import { getAuthenticatedProfile } from "@/lib/auth"
import { ScrollLessonClient } from "./scroll-lesson-client"

export const dynamic = "force-dynamic"

/**
 * Prototype: a scroll-driven, animated way to present a lesson to pupils.
 *
 * The opening screen shows the lesson title, unit title and the lesson's
 * learning objectives + success criteria. As the pupil scrolls, each activity
 * transitions in from alternating sides.
 *
 * Pass ?lessonId=<id> to preview a specific lesson, otherwise the lesson with
 * the most activities is chosen automatically.
 */
export default async function LessonDisplayPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ lessonId?: string }>
}) {
  const { lessonId: requestedLessonId } = await searchParams

  const lessonId = requestedLessonId ?? (await pickDefaultLessonId())

  if (!lessonId) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8 text-center">
        <p className="text-muted-foreground">
          No lessons with activities were found to preview.
        </p>
      </main>
    )
  }

  const profile = await getAuthenticatedProfile()

  const { data, error } = await readLessonDetailBootstrapAction(lessonId)

  if (error || !data?.lesson) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8 text-center">
        <p className="text-muted-foreground">
          {error ?? "This lesson could not be loaded."}
        </p>
      </main>
    )
  }

  const { lesson, unit, lessonActivities } = data

  const activities = lessonActivities
    .filter((activity) => activity.active !== false)
    .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))

  // Group success criteria under their learning objective for the hero screen.
  const criteriaByObjective = new Map<
    string,
    { id: string; title: string; description: string | null; level: number | null }[]
  >()
  for (const sc of lesson.lesson_success_criteria) {
    const key = sc.learning_objective_id ?? "__ungrouped__"
    const bucket = criteriaByObjective.get(key) ?? []
    bucket.push({
      id: sc.success_criteria_id,
      title: sc.title,
      description: sc.description ?? null,
      level: sc.level ?? null,
    })
    criteriaByObjective.set(key, bucket)
  }

  const objectives = lesson.lesson_objectives
    .slice()
    .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
    .map((lo) => ({
      id: lo.learning_objective_id,
      title: lo.title,
      criteria: (criteriaByObjective.get(lo.learning_objective_id) ?? []).sort(
        (a, b) => (a.level ?? 0) - (b.level ?? 0),
      ),
    }))

  // Any success criteria that were not attached to a listed objective.
  const ungroupedCriteria = criteriaByObjective.get("__ungrouped__") ?? []

  return (
    <ScrollLessonClient
      lessonId={lesson.lesson_id}
      lessonTitle={lesson.title}
      unitTitle={unit?.title ?? ""}
      objectives={objectives}
      ungroupedCriteria={ungroupedCriteria}
      activities={activities}
      pupilId={profile?.userId ?? ""}
      canAnswer={Boolean(profile?.userId)}
    />
  )
}

async function pickDefaultLessonId(): Promise<string | null> {
  try {
    const { rows } = await query<{ lesson_id: string }>(
      `
        select l.lesson_id
        from lessons l
        join activities a on a.lesson_id = l.lesson_id
        where l.active is not false
          and a.active = true
        group by l.lesson_id
        order by count(a.activity_id) desc
        limit 1
      `,
    )
    return rows[0]?.lesson_id ?? null
  } catch (error) {
    console.error("[lesson-display prototype] Failed to pick default lesson:", error)
    return null
  }
}
