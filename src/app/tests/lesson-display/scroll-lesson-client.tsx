"use client"

import type { LessonActivities } from "@/types"
import { FeedbackVisibilityProvider } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug"
import {
  ActivityReveal,
  LessonEnd,
  LessonHero,
  LessonScrollProgress,
  StickySectionHeading,
  type ScrollObjective,
  type ScrollObjectiveCriterion,
} from "@/components/lessons/lesson-scroll-layout"
import { PupilActivityRenderer } from "./pupil-activity-renderer"

interface ScrollLessonClientProps {
  lessonId: string
  lessonTitle: string
  unitTitle: string
  objectives: ScrollObjective[]
  ungroupedCriteria: ScrollObjectiveCriterion[]
  activities: LessonActivities
  pupilId: string
  canAnswer: boolean
}

export function ScrollLessonClient({
  lessonId,
  lessonTitle,
  unitTitle,
  objectives,
  ungroupedCriteria,
  activities,
  pupilId,
  canAnswer,
}: ScrollLessonClientProps) {
  // Group activities under any `display-section` headings, preserving order.
  const segments: { section: LessonActivities[number] | null; items: LessonActivities }[] = []
  for (const activity of activities) {
    if (activity.type === "display-section") {
      segments.push({ section: activity, items: [] })
    } else {
      if (segments.length === 0) segments.push({ section: null, items: [] })
      segments[segments.length - 1].items.push(activity)
    }
  }

  // Number only the answerable/display activities (not the section headings).
  const activityNumbers = new Map<string, number>()
  let runningNumber = 0
  for (const activity of activities) {
    if (activity.type === "display-section") continue
    runningNumber += 1
    activityNumbers.set(activity.activity_id, runningNumber)
  }
  const totalActivities = runningNumber

  return (
    <main className="relative bg-gradient-to-b from-background via-background to-muted/40">
      <LessonScrollProgress />

      <LessonHero
        lessonTitle={lessonTitle}
        unitTitle={unitTitle}
        objectives={objectives}
        ungroupedCriteria={ungroupedCriteria}
      />

      <FeedbackVisibilityProvider assignmentIds={[]} lessonId={lessonId} initialVisible={false}>
        <div className="mx-auto w-full max-w-3xl px-6 pb-40 pt-16">
          {activities.length === 0 ? (
            <p className="text-center text-muted-foreground">
              This lesson has no activities to display yet.
            </p>
          ) : (
            segments.map((segment, segmentIndex) => (
              <section key={segment.section?.activity_id ?? `segment-${segmentIndex}`}>
                {segment.section ? <StickySectionHeading title={segment.section.title} /> : null}

                <div className="flex flex-col gap-12 sm:gap-16">
                  {segment.items.map((activity) => {
                    const number = activityNumbers.get(activity.activity_id) ?? 0
                    return (
                      <ActivityReveal key={activity.activity_id} index={number - 1} total={totalActivities}>
                        <PupilActivityRenderer
                          activity={activity}
                          lessonId={lessonId}
                          pupilId={pupilId}
                          canAnswer={canAnswer}
                        />
                      </ActivityReveal>
                    )
                  })}
                </div>
              </section>
            ))
          )}

          <LessonEnd />
        </div>
      </FeedbackVisibilityProvider>
    </main>
  )
}
