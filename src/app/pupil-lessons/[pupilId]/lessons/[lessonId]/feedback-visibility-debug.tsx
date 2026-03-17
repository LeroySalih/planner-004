"use client"

import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { triggerMarkingComplete } from "@/lib/feedback-events"

type SseStatus = "idle" | "connecting" | "connected" | "error" | "disconnected"

export type MarkingResult = {
  score: number | null
  feedbackText: string | null
  receivedAt: string
}

type VisibilityState = {
  channels: string[]
  events: string[]
  currentVisible: boolean
  sseStatus: SseStatus
  lastEventAt: string | null
  markingResults: Map<string, MarkingResult>
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
  const [markingResults, setMarkingResults] = useState<Map<string, MarkingResult>>(new Map())

  useEffect(() => {
    setCurrentVisible(initialVisible)
  }, [initialVisible])

  const handleMarkingResult = useCallback(
    (activityId: string, pupilId: string, score: number | null, feedbackText: string | null) => {
      const receivedAt = new Date().toISOString()
      const result: MarkingResult = { score, feedbackText, receivedAt }

      console.log("[MarkingResults] state updated", {
        activityId,
        pupilId,
        score,
        feedbackText,
        receivedAt,
      })

      setMarkingResults((prev) => {
        const next = new Map(prev)
        next.set(activityId, result)
        console.log("[MarkingResults] full map after update", Object.fromEntries(next))
        return next
      })

      triggerMarkingComplete(activityId, pupilId, score, feedbackText)
    },
    [],
  )

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

      console.log("[SSE] raw message received", {
        topic: envelope.topic,
        type: envelope.type,
        payload: envelope.payload,
      })

      if (envelope.topic !== "assignments" || !envelope.payload) return

      const payload =
        typeof envelope.payload === "object" && envelope.payload && "payload" in envelope.payload
          ? (envelope.payload as { payload?: unknown }).payload
          : envelope.payload

      // Dispatch marking complete event for individual activity results
      if (envelope.type === "assignment.results.updated") {
        const p = payload as {
          activityId?: string
          pupilId?: string
          aiScore?: number | null
          aiFeedback?: string | null
        }
        console.log("[SSE] assignment.results.updated", {
          activityId: p?.activityId,
          pupilId: p?.pupilId,
          aiScore: p?.aiScore,
          aiFeedback: p?.aiFeedback,
        })
        if (typeof p?.activityId === "string" && typeof p?.pupilId === "string") {
          handleMarkingResult(
            p.activityId,
            p.pupilId,
            typeof p.aiScore === "number" ? p.aiScore : null,
            typeof p.aiFeedback === "string" ? p.aiFeedback : null,
          )
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
    () => ({ channels, events, currentVisible, sseStatus, lastEventAt, markingResults }),
    [channels, events, currentVisible, sseStatus, lastEventAt, markingResults],
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
  const markingResultEntries = Array.from(state.markingResults.entries())

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
        {state.events.length === 0 ? <li>No visibility events yet.</li> : null}
        {state.events.map((entry, index) => (
          <li key={`${entry}-${index}`}>{entry}</li>
        ))}
      </ul>
      {markingResultEntries.length > 0 && (
        <div className="mt-3 border-t border-primary/20 pt-2">
          <p className="font-semibold text-primary">Marking results (live)</p>
          <ul className="mt-1 space-y-1 text-[11px] text-primary/80">
            {markingResultEntries.map(([activityId, result]) => (
              <li key={activityId}>
                <span className="font-mono">{activityId.slice(0, 8)}…</span>
                {" "}score: {result.score !== null ? `${Math.round((result.score ?? 0) * 100)}%` : "null"}
                {result.feedbackText ? ` · "${result.feedbackText.slice(0, 40)}…"` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
