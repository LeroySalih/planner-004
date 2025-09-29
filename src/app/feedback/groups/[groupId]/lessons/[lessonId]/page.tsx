import Link from "next/link"
import { notFound } from "next/navigation"

import {
  readGroupAction,
  readLessonAction,
  readFeedbackForLessonAction,
  readAssignmentsForGroupAction,
  listLessonFilesAction,
  readUnitAction,
} from "@/lib/server-updates"

import { LessonDetailsPanel } from "./_lesson-panel"
import { LessonFeedbackTable } from "./lesson-feedback-table"
import { LessonResourcesPanel } from "./lesson-resources-panel"
import { LessonActivitiesLauncher } from "./lesson-activities-launcher"

export default async function FeedbackLessonPage({
  params,
}: {
  params: Promise<{ groupId: string; lessonId: string }>
}) {
  const { groupId, lessonId } = await params

  const [groupResult, lessonResult, feedbackResult, assignmentsResult, lessonFilesResult] = await Promise.all([
    readGroupAction(groupId),
    readLessonAction(lessonId),
    readFeedbackForLessonAction(lessonId),
    readAssignmentsForGroupAction(groupId),
    listLessonFilesAction(lessonId),
  ])

  if (groupResult.error && !groupResult.data) {
    throw new Error(groupResult.error)
  }

  const group = groupResult.data

  if (!group) {
    notFound()
  }

  if (lessonResult.error) {
    throw new Error(lessonResult.error)
  }

  const lesson = lessonResult.data

  if (!lesson) {
    notFound()
  }

  const unitResult = await readUnitAction(lesson.unit_id)
  const unitTitle = unitResult.data?.title ?? null

  const membershipError = groupResult.error

  const objectives = lesson.lesson_objectives ?? []
  const feedbackEntries = feedbackResult.data ?? []
  const feedbackError = feedbackResult.error
  const groupAssignments = assignmentsResult.data ?? []
  const groupUnitIds = new Set(groupAssignments.map((assignment) => assignment.unit_id))
  const lessonLinks = lesson.lesson_links ?? []
  const lessonFiles = lessonFilesResult.data ?? []
  const lessonFilesError = lessonFilesResult.error

  const allSuccessCriteria = objectives
    .flatMap((objective) => {
      const learningObjective = objective.learning_objective
      const successCriteria = learningObjective?.success_criteria ?? []
      const relevantCriteria = successCriteria.filter((criterion) => {
        const units = criterion.units ?? []
        if (groupUnitIds.size === 0) return false
        return units.some((unitId) => groupUnitIds.has(unitId))
      })

      return relevantCriteria.map((criterion) => ({
        criterion,
        learningObjective,
      }))
    })
    .sort((a, b) => {
      if (a.criterion.level !== b.criterion.level) {
        return a.criterion.level - b.criterion.level
      }
      return a.criterion.description.localeCompare(b.criterion.description)
    })

  const getMemberDisplayName = (member: (typeof group.members)[number]) => {
    const first = member.profile?.first_name?.trim() ?? ""
    const last = member.profile?.last_name?.trim() ?? ""
    const combined = `${first} ${last}`.trim()
    return combined.length > 0 ? combined : member.user_id
  }

  const pupils = group.members
    .filter((member) => member.role.toLowerCase() === "pupil")
    .slice()
    .sort((a, b) => getMemberDisplayName(a).localeCompare(getMemberDisplayName(b)))

  const successCriteriaColumns = allSuccessCriteria.map(({ criterion, learningObjective }) => ({
    id: criterion.success_criteria_id,
    description: criterion.description,
    level: criterion.level,
    learningObjectiveTitle: learningObjective?.title ?? null,
  }))

  const pupilRows = pupils.map((member) => ({
    userId: member.user_id,
    displayName: getMemberDisplayName(member),
  }))

  const initialRatings: Record<string, 1 | -1 | null> = {}
  for (const entry of feedbackEntries) {
    const key = `${entry.user_id}-${entry.success_criteria_id}`
    initialRatings[key] = entry.rating === 1 ? 1 : entry.rating === -1 ? -1 : null
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10 text-slate-200">
      <div className="text-sm text-slate-300">
        <Link href="/assignments" className="underline-offset-4 hover:underline">
          ← Back to assignments
        </Link>
      </div>

      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-wide text-slate-300">Feedback Overview</p>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h1 className="text-3xl font-semibold text-white">
              {group.group_id} · {lesson.title}
            </h1>
            <LessonActivitiesLauncher lesson={lesson} unitTitle={unitTitle} />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-300">
            <span>
              Subject: <span className="font-medium text-white">{group.subject}</span>
            </span>
            <span>
              Lesson ID: <span className="font-medium text-white">{lesson.lesson_id}</span>
            </span>
            <span>
              Unit: <span className="font-medium text-white">{unitTitle ?? lesson.unit_id}</span>
            </span>
          </div>
        </div>
      </header>
        

      {membershipError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load group membership completely: {membershipError}
        </div>
      ) : null}

      {feedbackError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load existing feedback: {feedbackError}
        </div>
      ) : null}

      {assignmentsResult.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load group assignments: {assignmentsResult.error}
        </div>
      ) : null}

      {lessonFilesError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load lesson files: {lessonFilesError}
        </div>
      ) : null}

      {unitResult.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load unit details: {unitResult.error}
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <LessonResourcesPanel
          lessonId={lesson.lesson_id}
          unitId={lesson.unit_id}
          links={lessonLinks}
          files={lessonFiles}
        />

        <LessonDetailsPanel
          lesson={{
            lesson_id: lesson.lesson_id,
            title: lesson.title,
            unit_id: lesson.unit_id,
            order_by: lesson.order_by ?? null,
            active: lesson.active ?? true,
          }}
        />
      </section>

      <LessonFeedbackTable
        lessonId={lesson.lesson_id}
        pupils={pupilRows}
        successCriteria={successCriteriaColumns}
        initialRatings={initialRatings}
        objectivesCount={objectives.length}
      />
    </main>
  )
}
