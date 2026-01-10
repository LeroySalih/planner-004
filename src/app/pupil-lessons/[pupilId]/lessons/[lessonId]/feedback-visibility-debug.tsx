"use client"

import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useMemo, useState } from "react"

type VisibilityState = {
  channels: string[]
  events: string[]
  currentVisible: boolean
}

const FeedbackVisibilityContext = createContext<VisibilityState | null>(null)

export function FeedbackVisibilityProvider({
  assignmentIds,
  lessonId,
  initialVisible,
  children,
}: {
  assignmentIds: string[]
  lessonId: string
  initialVisible: boolean
  children: ReactNode
}) {
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
      console.log("[FeedbackVisibilityProvider] No channels to subscribe to.")
      return
    }

    console.log("[FeedbackVisibilityProvider] Connecting SSE...", channels)
    const source = new EventSource("/sse?topics=assignments")

    source.onopen = () => {
      console.log("[FeedbackVisibilityProvider] SSE Connected")
    }

    source.onerror = (err) => {
      console.error("[FeedbackVisibilityProvider] SSE Error", err)
    }

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
      
      if (typeof nextVisible !== "boolean") return

      const targetAssignmentId =
        typeof (payload as { assignmentId?: string }).assignmentId === "string"
          ? (payload as { assignmentId: string }).assignmentId
          : null

      if (targetAssignmentId && !channels.includes(targetAssignmentId)) return

      console.log(`[FeedbackVisibilityProvider] Visibility changed for ${targetAssignmentId}: ${nextVisible}`)
      setCurrentVisible(nextVisible)
      setEvents((prev) => [...prev, `${targetAssignmentId ?? "unknown"}:${nextVisible ? "on" : "off"}`].slice(-10))
    }

    return () => {
      console.log("[FeedbackVisibilityProvider] Closing SSE")
      source.close()
    }
  }, [channels, lessonId])

  const value = useMemo(() => ({ channels, events, currentVisible }), [channels, events, currentVisible])

  return (
    <FeedbackVisibilityContext.Provider value={value}>
      {children}
    </FeedbackVisibilityContext.Provider>
  )
}

export function useFeedbackVisibility() {
  const context = useContext(FeedbackVisibilityContext)
  if (!context) {
    throw new Error("useFeedbackVisibility must be used within a FeedbackVisibilityProvider")
  }
  return context
}

export function FeedbackVisibilityDebugPanel() {
  const state = useFeedbackVisibility()
  return (
    <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-xs text-primary">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-primary">Feedback visibility debug</p>
        <span className="rounded-full border border-primary/30 px-2 py-0.5 text-[11px] font-semibold">
          visible: {state.currentVisible ? "yes" : "no"}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-primary/80">Assignments: {state.channels.join(", ")}</p>
      <ul className="mt-2 space-y-1 text-[11px] text-primary/80">
        {state.events.length === 0 ? <li>No events yet.</li> : null}
        {state.events.map((entry, index) => (
          <li key={`${entry}-${index}`}>{entry}</li>
        ))}
      </ul>
    </div>
  )
}