"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Play } from "lucide-react"
import { toast } from "sonner"

import type { LessonActivity, LessonLearningObjective } from "@/types"
import type { LessonFileInfo, LessonLinkInfo } from "@/components/units/lesson-sidebar"
import { LessonPupilPreview } from "@/components/lessons/lesson-pupil-preview"
import { Button } from "@/components/ui/button"
import {
  getActivityFileDownloadUrlAction,
  listActivityFilesAction,
  listLessonFilesAction,
} from "@/lib/server-updates"

interface LessonPreviewLauncherProps {
  lessonId: string
  lessonTitle: string
  unitTitle: string
  activities: LessonActivity[]
  activityFilesMap?: Record<string, LessonFileInfo[]>
  lessonFiles?: LessonFileInfo[]
  lessonLinks: LessonLinkInfo[]
  lessonObjectives: LessonLearningObjective[]
  className?: string
  /**
   * When set, "Preview lesson" opens the real pupil lesson view at this href
   * (the teacher previews as themselves) instead of the in-app present-mode
   * modal. This is the unified preview path.
   */
  previewHref?: string
}

const FILE_ACTIVITY_TYPES = new Set(["file-download", "upload-file", "voice"])

export function LessonPreviewLauncher({
  lessonId,
  lessonTitle,
  unitTitle,
  activities,
  activityFilesMap: providedActivityFilesMap,
  lessonFiles: providedLessonFiles,
  lessonLinks,
  lessonObjectives,
  className,
  previewHref,
}: LessonPreviewLauncherProps) {
  const [open, setOpen] = useState(false)
  const [fetchedLessonFiles, setFetchedLessonFiles] = useState<LessonFileInfo[]>([])
  const [fetchedActivityFilesMap, setFetchedActivityFilesMap] = useState<Record<string, LessonFileInfo[]>>({})

  const lessonFiles = providedLessonFiles ?? fetchedLessonFiles
  const activityFilesMap = providedActivityFilesMap ?? fetchedActivityFilesMap

  useEffect(() => {
    if (!open) return

    if (!providedLessonFiles) {
      listLessonFilesAction(lessonId).then((result) => {
        if (result.data) {
          setFetchedLessonFiles(result.data)
        }
      })
    }

    if (!providedActivityFilesMap) {
      const fileActivities = activities.filter((activity) => FILE_ACTIVITY_TYPES.has(activity.type ?? ""))
      fileActivities.forEach((activity) => {
        listActivityFilesAction(lessonId, activity.activity_id).then((result) => {
          if (result.data) {
            setFetchedActivityFilesMap((previous) => ({ ...previous, [activity.activity_id]: result.data ?? [] }))
          }
        })
      })
    }
  }, [open, lessonId, activities, providedLessonFiles, providedActivityFilesMap])

  const handleOpen = () => {
    setOpen(true)
  }

  // Unified preview: navigate to the real pupil lesson view (teacher previews
  // as themselves) in a new tab, keeping the lesson editor open.
  if (previewHref) {
    return (
      <Button asChild type="button" variant="secondary" className={className}>
        <Link href={previewHref} target="_blank" rel="noopener noreferrer">
          <Play className="mr-2 h-4 w-4" /> Preview lesson
        </Link>
      </Button>
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className={className}
        onClick={handleOpen}
      >
        <Play className="mr-2 h-4 w-4" /> Preview lesson
      </Button>

      {open ? (
        <LessonPupilPreview
          activities={activities}
          unitTitle={unitTitle}
          lessonTitle={lessonTitle}
          lessonId={lessonId}
          lessonObjectives={lessonObjectives}
          lessonLinks={lessonLinks}
          lessonFiles={lessonFiles}
          activityFilesMap={activityFilesMap}
          onClose={() => setOpen(false)}
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
      ) : null}
    </>
  )
}
