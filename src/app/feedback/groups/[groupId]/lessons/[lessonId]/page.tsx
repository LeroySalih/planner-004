import Link from "next/link"
import { notFound } from "next/navigation"

import { readGroupAction, readLessonAction, readFeedbackForLessonAction } from "@/lib/server-updates"

import { FeedbackCell } from "../../../../_components/feedback-cell"
import { GroupDetailsPanel } from "./_group-panel"
import { LessonDetailsPanel } from "./_lesson-panel"

export default async function FeedbackLessonPage({
  params,
}: {
  params: Promise<{ groupId: string; lessonId: string }>
}) {
  const { groupId, lessonId } = await params

  const [groupResult, lessonResult, feedbackResult] = await Promise.all([
    readGroupAction(groupId),
    readLessonAction(lessonId),
    readFeedbackForLessonAction(lessonId),
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

  const membershipError = groupResult.error

  const objectives = lesson.lesson_objectives ?? []
  const feedbackEntries = feedbackResult.data ?? []
  const feedbackError = feedbackResult.error
  const feedbackMap = new Map<string, number>(
    feedbackEntries.map((entry) => [`${entry.user_id}-${entry.success_criteria_id}`, entry.rating]),
  )

  const allSuccessCriteria = objectives
    .flatMap((objective) => {
      const learningObjective = objective.learning_objective
      const successCriteria = learningObjective?.success_criteria ?? []

      return successCriteria.map((criterion) => ({
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

  const totalMembers = group.members.length
  const roleCounts = group.members.reduce<Record<string, number>>((acc, member) => {
    const role = member.role?.toLowerCase() ?? "unknown"
    acc[role] = (acc[role] ?? 0) + 1
    return acc
  }, {})
  const otherRoles = Object.entries(roleCounts).filter(([role]) => role !== "pupil")

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="text-sm text-muted-foreground">
        <Link href="/assignments" className="underline-offset-4 hover:underline">
          ← Back to assignments
        </Link>
      </div>

      <header className="space-y-3">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Feedback Overview</p>
        <h1 className="text-3xl font-semibold text-primary">
          {group.group_id} · {lesson.title}
        </h1>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>
            Subject: <span className="font-medium text-foreground">{group.subject}</span>
          </span>
          <span>
            Lesson ID: <span className="font-medium text-foreground">{lesson.lesson_id}</span>
          </span>
          <span>
            Unit: <span className="font-medium text-foreground">{lesson.unit_id}</span>
          </span>
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

      <section className="grid gap-6 lg:grid-cols-2">
        <GroupDetailsPanel
          group={{
            group_id: group.group_id,
            subject: group.subject,
            join_code: group.join_code,
            active: group.active ?? true,
          }}
          totalMembers={totalMembers}
          pupilCount={pupils.length}
          otherRoles={otherRoles}
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

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Learning Objectives & Success Criteria</h2>
          <span className="text-sm text-muted-foreground">{objectives.length} learning objectives</span>
        </div>

        {objectives.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No learning objectives linked to this lesson yet.
          </p>
        ) : (
          <div className="mt-6 max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 bg-muted px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-muted-foreground border border-border shadow-sm">
                    Pupil
                  </th>
                  {allSuccessCriteria.map(({ criterion, learningObjective }) => (
                    <th
                      key={criterion.success_criteria_id}
                      className="sticky top-0 z-10 bg-muted px-4 py-3 text-left align-top border border-border shadow-sm"
                    >
                      <span className="block text-[11px] font-medium text-muted-foreground">
                        {learningObjective?.title ?? "Learning objective"}
                      </span>
                      <span className="mt-1 block text-sm font-semibold text-foreground">
                        {criterion.description}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">Level {criterion.level}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pupils.length === 0 ? (
                  <tr>
                    <td colSpan={allSuccessCriteria.length + 1} className="px-4 py-6 text-center text-sm text-muted-foreground border border-border">
                      No pupils assigned to this group yet.
                    </td>
                  </tr>
                ) : (
                  pupils.map((member) => {
                    const displayName = getMemberDisplayName(member)
                    return (
                      <tr key={member.user_id}>
                        <td className="sticky left-0 z-10 bg-background px-4 py-3 border border-border align-top shadow-sm">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-foreground">{displayName}</span>
                          </div>
                        </td>
                        {allSuccessCriteria.map(({ criterion }) => {
                          const rating = feedbackMap.get(`${member.user_id}-${criterion.success_criteria_id}`) ?? null
                          const normalizedRating = rating === 1 ? 1 : rating === -1 ? -1 : null
                          return (
                            <FeedbackCell
                              key={`${member.user_id}-${criterion.success_criteria_id}`}
                              pupilId={member.user_id}
                              pupilName={displayName}
                              criterionId={criterion.success_criteria_id}
                              criterionDescription={criterion.description}
                              lessonId={lesson.lesson_id}
                              initialRating={normalizedRating}
                            />
                          )
                        })}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
