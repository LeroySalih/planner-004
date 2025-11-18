"use client"

import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"

import { ASSIGNMENT_FEEDBACK_VISIBILITY_EVENT, buildAssignmentResultsChannelName } from "@/lib/results-channel"
import { supabaseBrowserClient } from "@/lib/supabase-browser"

type FeedbackVisibilityProps = {
  assignmentIds: string[]
  lessonId: string
  initialVisible: boolean
}

type VisibilityState = {
  channels: string[]
  events: string[]
  currentVisible: boolean
}

export function useFeedbackVisibility({ assignmentIds, lessonId, initialVisible }: FeedbackVisibilityProps) {
  const channels = useMemo(
    () => Array.from(new Set(assignmentIds.filter((id) => typeof id === "string" && id.trim().length > 0))),
    [assignmentIds],
  )
  const [events, setEvents] = useState<string[]>([])
  const [currentVisible, setCurrentVisible] = useState<boolean>(initialVisible)

  useEffect(() => {
    setCurrentVisible(initialVisible)
  }, [initialVisible])

  useEffect(() => {
    if (channels.length === 0) {
      return
    }

    let cancelled = false

    const groupIds = channels
      .map((id) => id.split("__")[0])
      .filter((value) => typeof value === "string" && value.trim().length > 0)

    const fetchVisibility = async () => {
      try {
        const { data, error } = await supabaseBrowserClient
          .from("lesson_assignments")
          .select("group_id, feedback_visible")
          .eq("lesson_id", lessonId)
          .in("group_id", groupIds)

        if (cancelled) return
        if (error) {
          setEvents((prev) => [...prev, `initial-error:${error.message}`].slice(-10))
          return
        }

        const anyVisible = (data ?? []).some((row) => Boolean(row?.feedback_visible))
        setCurrentVisible(anyVisible)
        setEvents((prev) => [...prev, `initial-visible:${anyVisible}`].slice(-10))
      } catch (error) {
        if (!cancelled) {
          setEvents((prev) => [...prev, `initial-error:${String(error)}`].slice(-10))
        }
      }
    }

    fetchVisibility()

    const supabaseChannels = channels.map((assignmentId) => {
      const channel = supabaseBrowserClient.channel(buildAssignmentResultsChannelName(assignmentId), {
        config: { broadcast: { ack: true } },
      })
      channel.on(
        "broadcast",
        { event: ASSIGNMENT_FEEDBACK_VISIBILITY_EVENT },
        (payload: { payload?: { feedbackVisible?: boolean } } | { feedbackVisible?: boolean }) => {
          const nextVisible =
            (payload as { feedbackVisible?: boolean })?.feedbackVisible ??
            (payload as { payload?: { feedbackVisible?: boolean } })?.payload?.feedbackVisible
          if (typeof nextVisible !== "boolean") {
            return
          }
          setCurrentVisible(nextVisible)
          setEvents((prev) => [...prev, `${assignmentId}:${nextVisible ? "on" : "off"}`].slice(-10))
        },
      )
      channel.subscribe()
      return channel
    })

    return () => {
      cancelled = true
      supabaseChannels.forEach((channel) => supabaseBrowserClient.removeChannel(channel))
    }
  }, [channels, lessonId])

  return { channels, events, currentVisible } satisfies VisibilityState
}

function FeedbackVisibilityPanelView({ channels, events, currentVisible }: VisibilityState) {
  if (channels.length === 0) {
    return null
  }

  return (
    <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-xs text-primary">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-primary">Feedback visibility debug</p>
        <span className="rounded-full border border-primary/30 px-2 py-0.5 text-[11px] font-semibold">
          visible: {currentVisible ? "yes" : "no"}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-primary/80">Assignments: {channels.join(", ")}</p>
      <ul className="mt-2 space-y-1 text-[11px] text-primary/80">
        {events.length === 0 ? <li>No events yet.</li> : null}
        {events.map((entry, index) => (
          <li key={`${entry}-${index}`}>{entry}</li>
        ))}
      </ul>
    </div>
  )
}

export function FeedbackVisibilityDebugPanel(props: FeedbackVisibilityProps) {
  const state = useFeedbackVisibility(props)
  return <FeedbackVisibilityPanelView {...state} />
}

export function FeedbackVisibilityBadge({
  assignmentIds,
  lessonId,
  initialVisible,
  children,
}: FeedbackVisibilityProps & { children?: (visible: boolean) => ReactNode }) {
  const state = useFeedbackVisibility({ assignmentIds, lessonId, initialVisible })
  return <>{children ? children(state.currentVisible) : null}</>
}
