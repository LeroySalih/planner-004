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
import { supabaseBrowserClient } from "@/lib/supabase-browser"

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

    const groupIds = normalizedAssignmentIds
      .map((id) => id.split("__")[0])
      .filter((value) => value && value.trim().length > 0)
    if (groupIds.length === 0) {
      return
    }

    let cancelled = false
    const resolveVisibility = async () => {
      try {
        const { data, error } = await supabaseBrowserClient
          .from("lesson_assignments")
          .select("feedback_visible")
          .in("group_id", groupIds)
          .eq("lesson_id", lessonId)

        if (cancelled) return
        if (error) {
          console.error("[pupil-feedback] Failed to resolve feedback visibility", error)
          return
        }
        const anyVisible = (data ?? []).some((row) => Boolean(row?.feedback_visible))
        setIsVisible(anyVisible)
      } catch (error) {
        if (!cancelled) {
          console.error("[pupil-feedback] Failed to resolve feedback visibility", error)
        }
      }
    }

    resolveVisibility()

    return () => {
      cancelled = true
    }
  }, [lessonId, normalizedAssignmentIds])

  useEffect(() => {
    if (normalizedAssignmentIds.length === 0) {
      return
    }

    const channels = normalizedAssignmentIds.map((assignmentId) => {
      const channel = supabaseBrowserClient.channel(buildAssignmentResultsChannelName(assignmentId), {
        config: { broadcast: { ack: true } },
      })

      channel.on(
        "broadcast",
        { event: ASSIGNMENT_FEEDBACK_VISIBILITY_EVENT },
        (event: { payload?: { feedbackVisible?: boolean } } | { feedbackVisible?: boolean }) => {
          const payload = "payload" in event ? event.payload : event
          const nextVisible =
            (payload as { feedbackVisible?: boolean })?.feedbackVisible ??
            (payload as { payload?: { feedbackVisible?: boolean } })?.payload?.feedbackVisible

          if (typeof nextVisible !== "boolean") {
            return
          }
          setIsVisible(nextVisible)
        },
      )
      channel.subscribe()
      return channel
    })

    return () => {
      channels.forEach((channel) => {
        supabaseBrowserClient.removeChannel(channel)
      })
    }
  }, [normalizedAssignmentIds])

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
