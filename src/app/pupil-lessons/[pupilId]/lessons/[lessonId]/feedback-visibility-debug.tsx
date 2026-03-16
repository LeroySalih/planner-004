"use client"

import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { triggerMarkingComplete } from "@/lib/feedback-events"

type SseStatus = "idle" | "connecting" | "connected" | "error" | "disconnected"

type VisibilityState = {
  channels: string[]
  events: string[]
  currentVisible: boolean
  sseStatus: SseStatus
  lastEventAt: string | null
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
  // Stable string key — prevents SSE from reconnecting on every router.refresh()
  // when assignmentIds content is unchanged but the array reference is new.
  const channelsKey = useMemo(
    () =>
      [...assignmentIds]
        .filter((id) => typeof id === "string" && id.trim().length > 0)
        .sort()
        .join(","),
    [assignmentIds],
  )
  const channels = useMemo(
    () => (channelsKey ? channelsKey.split(",") : []),
    [channelsKey],
  )

  const [events, setEvents] = useState<string[]>([])
  const [currentVisible, setCurrentVisible] = useState<boolean>(initialVisible)
  const [sseStatus, setSseStatus] = useState<SseStatus>("idle")
  const [lastEventAt, setLastEventAt] = useState<string | null>(null)

  useEffect(() => {
    setCurrentVisible(initialVisible)
  }, [initialVisible])

  useEffect(() => {
    if (!channelsKey) {
      console.log("[FeedbackVisibilityProvider] No channels to subscribe to.")
      setSseStatus("idle")
      return
    }

    console.log("[FeedbackVisibilityProvider] Connecting SSE...", channels)
    setSseStatus("connecting")
    const source = new EventSource("/sse?topics=assignments")

    source.onopen = () => {
      console.log("[FeedbackVisibilityProvider] SSE Connected")
      setSseStatus("connected")
    }

    source.onerror = (err) => {
      console.error("[FeedbackVisibilityProvider] SSE Error", err)
      setSseStatus("error")
    }

    source.onmessage = (event) => {
      setLastEventAt(new Date().toISOString())
      const envelope = JSON.parse(event.data) as { topic?: string; type?: string; payload?: unknown }
      if (envelope.topic !== "assignments" || !envelope.payload) return
      const payload =
        typeof envelope.payload === "object" && envelope.payload && "payload" in envelope.payload
          ? (envelope.payload as { payload?: unknown }).payload
          : envelope.payload
      // Dispatch marking complete event for individual activity results
      if (envelope.type === "assignment.results.updated") {
        const p = payload as { activityId?: string; pupilId?: string }
        if (typeof p?.activityId === "string" && typeof p?.pupilId === "string") {
          triggerMarkingComplete(p.activityId, p.pupilId)
        }
        return
      }

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
      setSseStatus("disconnected")
      source.close()
    }
  // Use channelsKey (string) not channels (array) — prevents reconnect when array ref changes but content is same
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelsKey, lessonId])

  const value = useMemo(
    () => ({ channels, events, currentVisible, sseStatus, lastEventAt }),
    [channels, events, currentVisible, sseStatus, lastEventAt],
  )

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

export function SseStatusIndicator() {
  const { sseStatus, lastEventAt, channels } = useFeedbackVisibility()

  const statusDot: Record<SseStatus, string> = {
    idle: "bg-muted-foreground/40",
    connecting: "bg-amber-400 animate-pulse",
    connected: "bg-emerald-500",
    error: "bg-destructive",
    disconnected: "bg-muted-foreground/40",
  }

  const statusLabel: Record<SseStatus, string> = {
    idle: "No channel",
    connecting: "Connecting…",
    connected: "Live",
    error: "Error",
    disconnected: "Disconnected",
  }

  const formattedTime = lastEventAt
    ? new Date(lastEventAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null

  if (channels.length === 0) return null

  return (
    <div className="mt-4 rounded-md border border-border bg-muted/30 px-2 py-2 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${statusDot[sseStatus]}`} />
        <span className="font-medium">{statusLabel[sseStatus]}</span>
      </div>
      {formattedTime && (
        <p className="mt-1 pl-3.5 text-[10px]">Last update: {formattedTime}</p>
      )}
    </div>
  )
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
