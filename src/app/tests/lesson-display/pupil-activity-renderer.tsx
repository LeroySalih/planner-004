"use client"

import { useCallback } from "react"
import type { LessonActivity } from "@/types"
import { LessonActivityView } from "@/components/lessons/activity-view"
import { getActivityFileDownloadUrlAction } from "@/lib/server-updates"
import { PupilMcqActivity } from "@/components/pupil/pupil-mcq-activity"
import { PupilShortTextActivity } from "@/components/pupil/pupil-short-text-activity"
import { PupilLongTextActivity } from "@/components/pupil/pupil-long-text-activity"
import { PupilUploadUrlActivity } from "@/components/pupil/pupil-upload-url-activity"
import { PupilDoFlashcardsActivity } from "@/components/pupil/pupil-do-flashcards-activity"

interface PupilActivityRendererProps {
  activity: LessonActivity
  lessonId: string
  pupilId: string
  canAnswer: boolean
}

/**
 * Render a single activity exactly as a pupil sees it — the real
 * `Pupil*Activity` answer components (question + input), not the teacher
 * `LessonActivityView` present view which carries marking/response chrome.
 *
 * Pure display types (text, image, video, section, flashcards) have no answer
 * UI, so they fall through to `LessonActivityView` in present mode, which shows
 * their content without any marking chrome.
 */
export function PupilActivityRenderer({
  activity,
  lessonId,
  pupilId,
  canAnswer,
}: PupilActivityRendererProps) {
  // Stable identity — present-mode media views depend on this in a useEffect, so
  // a fresh function each render would re-run their fetch loop indefinitely.
  const fetchActivityFileUrl = useCallback(
    async (activityId: string, fileName: string) => {
      const result = await getActivityFileDownloadUrlAction(
        lessonId,
        activityId,
        fileName,
      )
      return result?.success ? result.url ?? null : null
    },
    [lessonId],
  )

  switch (activity.type) {
    case "multiple-choice-question":
      return (
        <PupilMcqActivity
          lessonId={lessonId}
          activity={activity}
          pupilId={pupilId}
          canAnswer={canAnswer}
          initialSelection={null}
        />
      )

    case "short-text-question":
      return (
        <PupilShortTextActivity
          lessonId={lessonId}
          activity={activity}
          pupilId={pupilId}
          canAnswer={canAnswer}
          initialAnswer={null}
        />
      )

    case "long-text-question":
    case "text-question":
      return (
        <PupilLongTextActivity
          lessonId={lessonId}
          activity={activity}
          pupilId={pupilId}
          canAnswer={canAnswer}
          initialAnswer={null}
        />
      )

    case "upload-url":
      return (
        <PupilUploadUrlActivity
          lessonId={lessonId}
          activity={activity}
          pupilId={pupilId}
          canAnswer={canAnswer}
          initialAnswer={null}
          initialSubmissionId={null}
          initialIsFlagged={false}
        />
      )

    case "do-flashcards":
      return (
        <PupilDoFlashcardsActivity
          activity={activity}
          pupilId={pupilId}
          initialScore={null}
        />
      )

    default:
      // Pure display types (and any not-yet-wired answer types) render their
      // content through the present view, which has no marking chrome.
      return (
        <LessonActivityView
          mode="present"
          activity={activity}
          lessonId={lessonId}
          files={[]}
          onDownloadFile={() => {}}
          fetchActivityFileUrl={fetchActivityFileUrl}
        />
      )
  }
}
