"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import type { SseEventEnvelope } from "@/lib/sse/types"
import {
  readMarkingQueueAction,
  readFlaggedSubmissionsAction,
  readMentionsAction,
} from "@/lib/server-updates"

type Props = {
  initialMarkingCount: number
  initialFlaggedCount: number
  initialMentionsCount: number
  children: React.ReactNode
}

type LiveStatus = "connecting" | "connected" | "reconnecting" | "error"

export function DashboardClient({
  initialMarkingCount,
  initialFlaggedCount,
  initialMentionsCount,
  children,
}: Props) {
  const [markingCount, setMarkingCount] = useState(initialMarkingCount)
  const [flaggedCount, setFlaggedCount] = useState(initialFlaggedCount)
  const [mentionsCount, setMentionsCount] = useState(initialMentionsCount)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting")
  const sourceRef = useRef<EventSource | null>(null)

  const refetchCounts = useCallback(async () => {
    const [markingResult, flaggedResult, mentionsResult] = await Promise.all([
      readMarkingQueueAction(),
      readFlaggedSubmissionsAction(),
      readMentionsAction(),
    ])
    if (markingResult.data)  setMarkingCount(markingResult.data.reduce((s, i) => s + i.submissionCount, 0))
    if (flaggedResult.data)  setFlaggedCount(flaggedResult.data.length)
    if (mentionsResult.data) setMentionsCount(mentionsResult.data.length)
  }, [])

  useEffect(() => {
    const source = new EventSource("/sse?topics=submissions,assignments")
    sourceRef.current = source

    source.onopen = () => {
      setLiveStatus("connected")
      // Refetch on (re)connect to reset counts from authoritative source
      refetchCounts()
    }

    source.onerror = () => {
      setLiveStatus("reconnecting")
    }

    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const envelope = JSON.parse(event.data) as SseEventEnvelope

        if (
          envelope.topic === "assignments" &&
          envelope.type === "assignment.results.updated" &&
          envelope.payload?.aiScore
        ) {
          setMarkingCount((c) => c + 1)
        }

        if (envelope.topic === "submissions" && envelope.type === "submission.flagged") {
          setFlaggedCount((c) => c + 1)
        }

        if (envelope.topic === "submissions" && envelope.type === "submission.comment_added") {
          setMentionsCount((c) => c + 1)
        }
      } catch {
        // Ignore malformed events (pings arrive as non-JSON comments)
      }
    }

    return () => {
      source.close()
    }
  }, [refetchCounts])

  const dotColor =
    liveStatus === "connected"
      ? "bg-green-500"
      : liveStatus === "connecting" || liveStatus === "reconnecting"
        ? "bg-amber-500"
        : "bg-red-500"

  return (
    <div
      data-marking-count={markingCount}
      data-flagged-count={flaggedCount}
      data-mentions-count={mentionsCount}
      data-live-status={liveStatus}
    >
      {/* Live status bar */}
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-5 py-3">
        <div className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="text-xs text-slate-500">
          {liveStatus === "connected" ? "Live" : liveStatus === "reconnecting" ? "Reconnecting..." : "Offline"}
        </span>
        <span className="ml-auto text-xs text-slate-500">
          {markingCount > 0 && (
            <span className="mr-3 font-semibold text-amber-400">{markingCount} to review</span>
          )}
          {flaggedCount > 0 && (
            <span className="mr-3 font-semibold text-red-400">{flaggedCount} flagged</span>
          )}
          {mentionsCount > 0 && (
            <span className="font-semibold text-blue-400">{mentionsCount} mentions</span>
          )}
        </span>
      </div>
      {children}
    </div>
  )
}
