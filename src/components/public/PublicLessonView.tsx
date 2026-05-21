"use client"

import type { LessonActivities } from "@/types"
import { isPublicActivityType } from "@/dino.config"
import { LessonActivityView } from "@/components/lessons/activity-view"

interface PublicLessonViewProps {
  activities: LessonActivities
  lessonId: string
}

export function PublicLessonView({ activities, lessonId }: PublicLessonViewProps) {
  const visible = activities
    .filter((a) => a.active !== false && isPublicActivityType(a.type ?? ""))
    .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))

  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No public content available for this lesson.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {visible.map((activity) => (
        <div key={activity.activity_id}>
          {activity.title ? (
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {activity.title}
            </p>
          ) : null}
          <LessonActivityView
            mode="present"
            activity={activity}
            lessonId={lessonId}
            files={[]}
            onDownloadFile={() => {}}
          />
        </div>
      ))}
    </div>
  )
}
