"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

type PupilStatus = "not_started" | "in_progress" | "completed"

type Pupil = {
  pupilId: string
  firstName: string
  lastName: string
  sessionId: string | null
  status: PupilStatus
  totalCards: number
  correctCount: number
}

type Props = {
  initialPupils: Pupil[]
  lessonId: string
}

type SsePayload = {
  pupilId?: string
  lessonId?: string
  sessionId?: string
  consecutiveCorrect?: number
  totalCards?: number
  status?: string
}

export function LiveFlashcardMonitor({ initialPupils, lessonId }: Props) {
  const [pupils, setPupils] = useState<Pupil[]>(initialPupils)
  const [connected, setConnected] = useState(false)

  const pupilIdSet = useMemo(
    () => new Set(initialPupils.map((p) => p.pupilId)),
    [initialPupils],
  )

  useEffect(() => {
    const eventSource = new EventSource("/sse?topics=flashcards")

    eventSource.onopen = () => setConnected(true)
    eventSource.onerror = () => setConnected(false)

    eventSource.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as {
          topic?: string
          type?: string
          payload?: SsePayload
        }
        if (envelope.topic !== "flashcards") return

        const payload = envelope.payload
        if (!payload?.pupilId || !payload?.lessonId) return
        if (payload.lessonId !== lessonId) return
        if (!pupilIdSet.has(payload.pupilId)) return

        const { pupilId, consecutiveCorrect, totalCards, sessionId } = payload

        setPupils((prev) =>
          prev.map((p) => {
            if (p.pupilId !== pupilId) return p

            if (envelope.type === "flashcard.start") {
              return {
                ...p,
                sessionId: sessionId ?? p.sessionId,
                status: "in_progress",
                totalCards: totalCards ?? p.totalCards,
                correctCount: 0,
              }
            }

            if (envelope.type === "flashcard.complete") {
              return {
                ...p,
                sessionId: sessionId ?? p.sessionId,
                status: "completed",
                totalCards: totalCards ?? p.totalCards,
                correctCount: totalCards ?? p.totalCards,
              }
            }

            if (envelope.type === "flashcard.progress") {
              return {
                ...p,
                sessionId: sessionId ?? p.sessionId,
                status: "in_progress",
                totalCards: totalCards ?? p.totalCards,
                correctCount: typeof consecutiveCorrect === "number" ? consecutiveCorrect : p.correctCount,
              }
            }

            return p
          }),
        )
      } catch {
        // ignore malformed events
      }
    }

    return () => eventSource.close()
  }, [lessonId, pupilIdSet])

  const completedCount = pupils.filter((p) => p.status === "completed").length

  return (
    <div className="flex flex-col gap-6">
      {/* Summary bar */}
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold">
            {completedCount}/{pupils.length}
          </span>
          <span className="text-sm text-muted-foreground">pupils complete</span>
        </div>
        <Badge variant={connected ? "secondary" : "outline"}>
          {connected ? "Live" : "Reconnecting..."}
        </Badge>
      </div>

      {/* Pupil list */}
      <div className="flex flex-col gap-3">
        {pupils.map((p) => (
          <PupilRow key={p.pupilId} pupil={p} />
        ))}
      </div>
    </div>
  )
}

function PupilRow({ pupil }: { pupil: Pupil }) {
  const progressPercent =
    pupil.totalCards > 0
      ? Math.round((pupil.correctCount / pupil.totalCards) * 100)
      : 0

  const statusLabel =
    pupil.status === "completed"
      ? "Complete"
      : pupil.status === "in_progress"
        ? "In progress"
        : "Not started"

  const statusColor =
    pupil.status === "completed"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
      : pupil.status === "in_progress"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
        : "bg-muted text-muted-foreground"

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-4 transition-colors",
        pupil.status === "completed" && "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {pupil.firstName} {pupil.lastName}
        </span>
        <div className="flex items-center gap-3">
          {pupil.status !== "not_started" && (
            <span className="text-sm tabular-nums text-muted-foreground">
              {pupil.correctCount}/{pupil.totalCards}
            </span>
          )}
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", statusColor)}>
            {statusLabel}
          </span>
        </div>
      </div>
      {pupil.status !== "not_started" && (
        <Progress value={progressPercent} className="h-2" />
      )}
    </div>
  )
}
