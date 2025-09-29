"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import {
  getActivityFileDownloadUrlAction,
  getLessonFileDownloadUrlAction,
  listActivityFilesAction,
  listLessonActivitiesAction,
  listLessonFilesAction,
  listLessonLinksAction,
} from "@/lib/server-updates"
import type { LessonActivity, LessonWithObjectives } from "@/types"
import { Button } from "@/components/ui/button"
import {
  LessonPresentation,
  type LessonFileInfo,
  type LessonLinkInfo,
} from "@/components/units/lesson-sidebar"

interface LessonActivitiesLauncherProps {
  lesson: LessonWithObjectives
  unitTitle: string | null
}

interface PresentationState {
  lesson: LessonWithObjectives
  activities: LessonActivity[]
  files: LessonFileInfo[]
  links: LessonLinkInfo[]
  activityFilesMap: Record<string, LessonFileInfo[]>
  loading: boolean
}

export function LessonActivitiesLauncher({ lesson, unitTitle }: LessonActivitiesLauncherProps) {
  const [presentation, setPresentation] = useState<PresentationState | null>(null)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [isLoadingActivities, startActivitiesTransition] = useTransition()
  const [, startDownloadTransition] = useTransition()

  const handleClose = () => {
    setPresentation(null)
    setCurrentIndex(-1)
  }

  const handleShowActivities = () => {
    if (isLoadingActivities) return

    setPresentation({
      lesson,
      activities: [],
      files: [],
      links: [],
      activityFilesMap: {},
      loading: true,
    })
    setCurrentIndex(-1)

    startActivitiesTransition(async () => {
      try {
        const activitiesResult = await listLessonActivitiesAction(lesson.lesson_id)
        if (activitiesResult.error) {
          throw new Error(activitiesResult.error)
        }

        const activities = (activitiesResult.data ?? []).slice()

        if (activities.length === 0) {
          toast.info("This lesson doesn't have any activities yet.")
          setPresentation(null)
          setCurrentIndex(-1)
          return
        }

        const [filesResult, linksResult] = await Promise.all([
          listLessonFilesAction(lesson.lesson_id),
          listLessonLinksAction(lesson.lesson_id),
        ])

        if (filesResult.error) {
          toast.error("Failed to load lesson files", {
            description: filesResult.error,
          })
        }
        if (linksResult.error) {
          toast.error("Failed to load lesson links", {
            description: linksResult.error,
          })
        }

        const files = filesResult.data ?? []
        const links = linksResult.data ?? []

        const activitiesRequiringFiles = activities.filter(
          (activity) => activity.type === "file-download" || activity.type === "voice",
        )

        const activityFilesEntries = await Promise.all(
          activitiesRequiringFiles.map(async (activity) => {
            const result = await listActivityFilesAction(lesson.lesson_id, activity.activity_id)
            if (result.error) {
              toast.error("Failed to load activity files", {
                description: result.error,
              })
              return [activity.activity_id, []] as const
            }
            return [activity.activity_id, result.data ?? []] as const
          }),
        )

        const activityFilesMap = Object.fromEntries(activityFilesEntries)

        setPresentation((prev) => {
          if (!prev || prev.lesson.lesson_id !== lesson.lesson_id) {
            return prev
          }
          return {
            lesson,
            activities,
            files,
            links,
            activityFilesMap,
            loading: false,
          }
        })
      } catch (error) {
        console.error("[feedback] Failed to show lesson activities:", error)
        toast.error("Unable to load activities", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
        setPresentation(null)
        setCurrentIndex(-1)
      }
    })
  }

  const handleNext = () => {
    setCurrentIndex((previous) => {
      if (!presentation || presentation.activities.length === 0) {
        return previous
      }
      if (previous < 0) {
        return 0
      }
      if (previous < presentation.activities.length - 1) {
        return previous + 1
      }
      return previous
    })
  }

  const handlePrevious = () => {
    setCurrentIndex((previous) => (previous <= 0 ? -1 : previous - 1))
  }

  const isBusy = isLoadingActivities || Boolean(presentation?.loading)

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={handleShowActivities}
        disabled={isBusy}
      >
        {isBusy ? "Loading activities…" : "Show activities"}
      </Button>

      {presentation ? (
        <>
          <LessonPresentation
            activities={presentation.activities}
            currentIndex={currentIndex}
            unitTitle={unitTitle ?? lesson.unit_id}
            lessonTitle={presentation.lesson.title}
            lessonObjectives={presentation.lesson.lesson_objectives ?? []}
            lessonLinks={presentation.links}
            lessonFiles={presentation.files}
            activityFilesMap={presentation.activityFilesMap}
            onClose={handleClose}
            onNext={handleNext}
            onPrevious={handlePrevious}
            onDownloadFile={(fileName) => {
              startDownloadTransition(async () => {
                const result = await getLessonFileDownloadUrlAction(lesson.lesson_id, fileName)
                if (!result.success || !result.url) {
                  toast.error("Failed to download file", {
                    description: result.error ?? "Please try again later.",
                  })
                  return
                }
                window.open(result.url, "_blank")
              })
            }}
            onDownloadActivityFile={(activityId, fileName) => {
              startDownloadTransition(async () => {
                const result = await getActivityFileDownloadUrlAction(lesson.lesson_id, activityId, fileName)
                if (!result.success || !result.url) {
                  toast.error("Failed to download activity file", {
                    description: result.error ?? "Please try again later.",
                  })
                  return
                }
                window.open(result.url, "_blank")
              })
            }}
            fetchActivityFileUrl={async (activityId, fileName) => {
              const result = await getActivityFileDownloadUrlAction(lesson.lesson_id, activityId, fileName)
              if (!result.success || !result.url) {
                toast.error("Failed to load file", {
                  description: result.error ?? "Please try again later.",
                })
                return null
              }
              return result.url
            }}
          />

          {presentation.loading || isLoadingActivities ? (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40">
              <div className="rounded-md bg-background px-4 py-2 text-sm text-foreground shadow-md">
                Loading activities…
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  )
}
