"use client"

import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"

import { ASSIGNMENT_FEEDBACK_VISIBILITY_EVENT, buildAssignmentResultsChannelName } from "@/lib/results-channel"

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
      const targetAssignmentId =
        typeof (payload as { assignmentId?: string }).assignmentId === "string"
          ? (payload as { assignmentId: string }).assignmentId
          : null
      if (targetAssignmentId && !channels.includes(targetAssignmentId)) return
      setCurrentVisible(nextVisible)
      setEvents((prev) => [...prev, `${targetAssignmentId ?? "unknown"}:${nextVisible ? "on" : "off"}`].slice(-10))
    }

    return () => {
      source.close()
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
