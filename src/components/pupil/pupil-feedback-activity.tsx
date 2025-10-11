"use client"

import { useCallback } from "react"

import type { LessonActivity } from "@/types"
import {
  LessonActivityView,
  type LessonActivityFile,
} from "@/components/lessons/activity-view"

interface PupilFeedbackActivityProps {
  lessonId: string
  activity: LessonActivity
  files?: LessonActivityFile[]
}

export function PupilFeedbackActivity({
  lessonId,
  activity,
  files = [],
}: PupilFeedbackActivityProps) {
  const handleDownloadFile = useCallback(() => {
    // Pupils cannot download files from feedback summaries
  }, [])

  return (
    <LessonActivityView
      mode="present"
      activity={activity}
      lessonId={lessonId}
      files={files}
      onDownloadFile={handleDownloadFile}
      viewerCanReveal={false}
    />
  )
}
