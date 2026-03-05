"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

type Pupil = {
  pupilId: string
  firstName: string
  lastName: string
}

type SessionStats = {
  sessionId: string
  pupilId: string
  activityId: string
  activityTitle: string
  status: "in_progress" | "completed"
  totalCards: number
  consecutiveCorrect: number
  correctCount: number
  wrongCount: number
  startedAt: string
  completedAt: string | null
}

type SsePayload = {
  pupilId?: string
  activityId?: string
  sessionId?: string
  consecutiveCorrect?: number
  totalCards?: number
  status?: string
  correctCount?: number
  wrongCount?: number
}

type Props = {
  initialPupils: Pupil[]
  initialSessions: SessionStats[]
}

export function ClassFlashcardMonitor({ initialPupils, initialSessions }: Props) {
  const [sessionMap, setSessionMap] = useState<Map<string, SessionStats>>(() => {
    const map = new Map<string, SessionStats>()
    for (const s of initialSessions) {
      map.set(s.sessionId, s)
    }
    return map
  })
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
        if (!payload?.pupilId || !payload?.sessionId) return
        if (!pupilIdSet.has(payload.pupilId)) return

        const { pupilId, activityId, sessionId, consecutiveCorrect, totalCards, correctCount, wrongCount } = payload

        setSessionMap((prev) => {
          const next = new Map(prev)

          if (envelope.type === "flashcard.start") {
            next.set(sessionId!, {
              sessionId: sessionId!,
              pupilId: pupilId!,
              activityId: activityId ?? "",
              activityTitle: "Flashcards",
              status: "in_progress",
              totalCards: totalCards ?? 0,
              consecutiveCorrect: 0,
              correctCount: 0,
              wrongCount: 0,
              startedAt: new Date().toISOString(),
              completedAt: null,
            })
          } else if (envelope.type === "flashcard.progress") {
            const existing = next.get(sessionId!)
            if (existing) {
              next.set(sessionId!, {
                ...existing,
                consecutiveCorrect:
                  typeof consecutiveCorrect === "number"
                    ? consecutiveCorrect
                    : existing.consecutiveCorrect,
                totalCards:
                  typeof totalCards === "number" ? totalCards : existing.totalCards,
                correctCount:
                  typeof correctCount === "number" ? correctCount : existing.correctCount,
                wrongCount:
                  typeof wrongCount === "number" ? wrongCount : existing.wrongCount,
              })
            }
          } else if (envelope.type === "flashcard.complete") {
            const existing = next.get(sessionId!)
            if (existing) {
              next.set(sessionId!, {
                ...existing,
                status: "completed",
                consecutiveCorrect: totalCards ?? existing.totalCards,
                completedAt: new Date().toISOString(),
              })
            }
          }

          return next
        })
      } catch {
        // ignore malformed events
      }
    }

    return () => eventSource.close()
  }, [pupilIdSet])

  const sessions = useMemo(() => Array.from(sessionMap.values()), [sessionMap])

  const sessionsByPupil = useMemo(() => {
    const map = new Map<string, SessionStats[]>()
    for (const s of sessions) {
      const arr = map.get(s.pupilId) ?? []
      arr.push(s)
      map.set(s.pupilId, arr)
    }
    return map
  }, [sessions])

  const sortedPupils = useMemo(
    () =>
      [...initialPupils].sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName) ||
          a.firstName.localeCompare(b.firstName),
      ),
    [initialPupils],
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Badge variant={connected ? "secondary" : "outline"}>
          {connected ? "Live" : "Reconnecting..."}
        </Badge>
      </div>

      <div className="flex flex-col gap-3">
        {sortedPupils.map((pupil) => {
          const pupilSessions = sessionsByPupil.get(pupil.pupilId) ?? []
          return (
            <PupilRow key={pupil.pupilId} pupil={pupil} sessions={pupilSessions} />
          )
        })}
      </div>
    </div>
  )
}

function PupilRow({ pupil, sessions }: { pupil: Pupil; sessions: SessionStats[] }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 font-medium">
        {pupil.firstName} {pupil.lastName}
      </h3>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent activity</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {sessions.map((s) => (
            <SessionCard key={s.sessionId} session={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionCard({ session }: { session: SessionStats }) {
  const progressPercent =
    session.totalCards > 0
      ? Math.round((session.consecutiveCorrect / session.totalCards) * 100)
      : 0

  const isComplete = session.status === "completed"

  return (
    <div
      className={cn(
        "flex w-48 flex-col gap-2 rounded-md border p-3",
        isComplete &&
          "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{session.activityTitle}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-xs",
            isComplete
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
          )}
        >
          {isComplete ? "✓" : "●"}
        </span>
      </div>

      <div className="flex gap-3 text-sm">
        <span className="text-emerald-700 dark:text-emerald-400">✓ {session.correctCount}</span>
        <span className="text-red-700 dark:text-red-400">✗ {session.wrongCount}</span>
      </div>

      <Progress value={progressPercent} className="h-1.5" />
      <span className="text-xs text-muted-foreground">
        {isComplete
          ? "Complete"
          : `${session.consecutiveCorrect}/${session.totalCards} in a row`}
      </span>
    </div>
  )
}
