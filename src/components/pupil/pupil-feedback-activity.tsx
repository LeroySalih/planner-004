"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import type { LessonActivity } from "@/types"
import {
  LessonActivityView,
  type LessonActivityFile,
} from "@/components/lessons/activity-view"
import {
  ASSIGNMENT_FEEDBACK_VISIBILITY_EVENT,
  buildAssignmentResultsChannelName,
} from "@/lib/results-channel"

interface PupilFeedbackActivityProps {
  lessonId: string
  activity: LessonActivity
  files?: LessonActivityFile[]
  assignmentIds?: string[]
  initialVisible?: boolean
}

export function PupilFeedbackActivity({
  lessonId,
  activity,
  files = [],
  assignmentIds = [],
  initialVisible = false,
}: PupilFeedbackActivityProps) {
  const normalizedAssignmentIds = useMemo(
    () => Array.from(new Set((assignmentIds ?? []).filter((id): id is string => Boolean(id && id.trim())))),
    [assignmentIds],
  )
  const [isVisible, setIsVisible] = useState<boolean>(initialVisible)

  useEffect(() => {
    setIsVisible(initialVisible)
  }, [initialVisible])

  const handleDownloadFile = useCallback(() => {
    // Pupils cannot download files from feedback summaries
  }, [])

  useEffect(() => {
    if (normalizedAssignmentIds.length === 0) {
      return
    }

    const source = new EventSource("/sse?topics=assignments")

    source.onmessage = (event) => {
      const envelope = JSON.parse(event.data) as { topic?: string; type?: string; payload?: unknown }
      if (envelope.topic !== "assignments" || !envelope.payload) return
      const payload =
        typeof envelope.payload === "object" && envelope.payload && "payload" in envelope.payload
          ? (envelope.payload as { payload?: unknown }).payload
          : envelope.payload
      const nextVisible =
        (payload as { feedbackVisible?: boolean })?.feedbackVisible ??
        (payload as { payload?: { feedbackVisible?: boolean } })?.payload?.feedbackVisible
      if (typeof nextVisible !== "boolean") {
        return
      }
      const assignmentId =
        typeof (payload as { assignmentId?: string }).assignmentId === "string"
          ? (payload as { assignmentId: string }).assignmentId
          : null
      if (assignmentId && !normalizedAssignmentIds.includes(assignmentId)) {
        return
      }
      setIsVisible(nextVisible)
    }

    source.onerror = () => {
      // allow browser to retry
    }

    return () => {
      source.close()
    }
  }, [lessonId, normalizedAssignmentIds])

  if (!isVisible) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
        Feedback is hidden for this assignment. Your teacher will let you know when it is available.
      </div>
    )
  }

  return (
    <LessonActivityView
      mode="present"
      activity={activity}
      lessonId={lessonId}
      files={files}
      onDownloadFile={handleDownloadFile}
      viewerCanReveal={isVisible}
      forceEnableFeedback={isVisible}
    />
  )
}
