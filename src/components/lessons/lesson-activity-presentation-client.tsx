"use client"

import { useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import type { LessonActivity, LessonLearningObjective } from "@/types"
import {
  LessonPresentation,
  type LessonFileInfo,
  type LessonLinkInfo,
} from "@/components/units/lesson-sidebar"
import {
  getActivityFileDownloadUrlAction,
  getLessonFileDownloadUrlAction,
} from "@/lib/server-updates"

interface LessonActivityPresentationClientProps {
  lessonId: string
  lessonTitle: string
  unitTitle: string
  activities: LessonActivity[]
  activityFilesMap: Record<string, LessonFileInfo[]>
  lessonFiles: LessonFileInfo[]
  lessonLinks: LessonLinkInfo[]
  lessonObjectives: LessonLearningObjective[]
  currentActivityId: string
}

function sortActivities(activities: LessonActivity[]): LessonActivity[] {
  return [...activities].sort((a, b) => {
    const aOrder = typeof a.order_by === "number" ? a.order_by : Number.MAX_SAFE_INTEGER
    const bOrder = typeof b.order_by === "number" ? b.order_by : Number.MAX_SAFE_INTEGER

    if (aOrder !== bOrder) {
      return aOrder - bOrder
    }

    return a.title.localeCompare(b.title)
  })
}

export function LessonActivityPresentationClient({
  lessonId,
  lessonTitle,
  unitTitle,
  activities,
  activityFilesMap,
  lessonFiles,
  lessonLinks,
  lessonObjectives,
  currentActivityId,
}: LessonActivityPresentationClientProps) {
  const router = useRouter()
  const [, startDownloadTransition] = useTransition()

  const orderedActivities = useMemo(() => sortActivities(activities), [activities])
  const currentIndex = useMemo(() => {
    return orderedActivities.findIndex((activity) => activity.activity_id === currentActivityId)
  }, [orderedActivities, currentActivityId])

  const goToLesson = () => {
    router.push(`/lessons/${encodeURIComponent(lessonId)}`)
  }

  const goToActivity = (activityId: string) => {
    router.push(
      `/lessons/${encodeURIComponent(lessonId)}/activities/activity/${encodeURIComponent(activityId)}`,
    )
  }

  const goToActivitiesOverview = () => {
    router.push(`/lessons/${encodeURIComponent(lessonId)}/activities`)
  }

  const handleNext = () => {
    if (currentIndex < 0) {
      if (orderedActivities.length > 0) {
        goToActivity(orderedActivities[0].activity_id)
      }
      return
    }

    if (currentIndex < orderedActivities.length - 1) {
      goToActivity(orderedActivities[currentIndex + 1].activity_id)
    }
  }

  const handlePrevious = () => {
    if (currentIndex <= 0) {
      goToActivitiesOverview()
      return
    }

    goToActivity(orderedActivities[currentIndex - 1].activity_id)
  }

  return (
    <LessonPresentation
      activities={orderedActivities}
      currentIndex={currentIndex}
      unitTitle={unitTitle}
      lessonTitle={lessonTitle}
      lessonId={lessonId}
      lessonObjectives={lessonObjectives}
      lessonLinks={lessonLinks}
      lessonFiles={lessonFiles}
      activityFilesMap={activityFilesMap}
      onClose={goToLesson}
      onNext={handleNext}
      onPrevious={handlePrevious}
      onDownloadFile={(fileName) => {
        startDownloadTransition(async () => {
          const result = await getLessonFileDownloadUrlAction(lessonId, fileName)
          if (!result.success || !result.url) {
            toast.error("Unable to download file", {
              description: result.error ?? "Please try again later.",
            })
            return
          }
          window.open(result.url, "_blank", "noopener,noreferrer")
        })
      }}
      onDownloadActivityFile={(activityId, fileName) => {
        startDownloadTransition(async () => {
          const result = await getActivityFileDownloadUrlAction(lessonId, activityId, fileName)
          if (!result.success || !result.url) {
            toast.error("Unable to download activity file", {
              description: result.error ?? "Please try again later.",
            })
            return
          }
          window.open(result.url, "_blank", "noopener,noreferrer")
        })
      }}
      fetchActivityFileUrl={async (activityId, fileName) => {
        const result = await getActivityFileDownloadUrlAction(lessonId, activityId, fileName)
        if (!result.success || !result.url) {
          toast.error("Unable to load activity file", {
            description: result.error ?? "Please try again later.",
          })
          return null
        }
        return result.url
      }}
    />
  )
}
