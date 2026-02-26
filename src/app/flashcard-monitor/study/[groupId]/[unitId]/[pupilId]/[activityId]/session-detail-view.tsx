"use client"

import { cn } from "@/lib/utils"

type Attempt = {
  term: string
  definition: string
  chosenDefinition: string
  isCorrect: boolean
  attemptNumber: number
  attemptedAt: string
}

type Session = {
  sessionId: string
  activityTitle: string
  status: string
  startedAt: string
  completedAt: string | null
  totalCards: number
  correctCount: number
  attempts: Attempt[]
}

type Props = {
  sessions: Session[]
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const day = d.getDate().toString().padStart(2, "0")
  const month = (d.getMonth() + 1).toString().padStart(2, "0")
  const year = d.getFullYear()
  const hours = d.getHours().toString().padStart(2, "0")
  const minutes = d.getMinutes().toString().padStart(2, "0")
  return `${day}-${month}-${year} ${hours}:${minutes}`
}

export function SessionDetailView({ sessions }: Props) {
  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">No flashcard sessions found for this pupil.</p>
  }

  return (
    <div className="space-y-6">
      <div id="summary" className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-2 text-left font-medium">Session</th>
              <th className="px-4 py-2 text-left font-medium">Activity</th>
              <th className="px-4 py-2 text-center font-medium">Status</th>
              <th className="px-4 py-2 text-center font-medium">Questions</th>
              <th className="px-4 py-2 text-center font-medium">Correct</th>
              <th className="px-4 py-2 text-center font-medium">Incorrect</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session, i) => {
              const incorrectCount = session.attempts.filter((a) => !a.isCorrect).length
              return (
                <tr
                  key={session.sessionId}
                  className={cn("border-b last:border-0", i % 2 === 0 && "bg-muted/20")}
                >
                  <td className="px-4 py-2">
                    <a
                      href={`#session-${session.sessionId}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {formatDateTime(session.startedAt)}
                    </a>
                  </td>
                  <td className="px-4 py-2">{session.activityTitle}</td>
                  <td className="px-4 py-2 text-center">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        session.status === "completed"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
                      )}
                    >
                      {session.status === "completed" ? "Completed" : "In Progress"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">{session.totalCards}</td>
                  <td className="px-4 py-2 text-center">{session.correctCount}</td>
                  <td className="px-4 py-2 text-center">{incorrectCount}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {sessions.map((session) => {
        const incorrectCount = session.attempts.filter((a) => !a.isCorrect).length
        return (
          <div key={session.sessionId} id={`session-${session.sessionId}`} className="rounded-lg border scroll-mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                    session.status === "completed"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
                  )}
                >
                  {session.status === "completed" ? "Completed" : "In Progress"}
                </span>
                <span className="text-sm font-medium">{session.activityTitle}</span>
                <span className="text-sm text-muted-foreground">
                  Started: {formatDateTime(session.startedAt)}
                </span>
                {session.completedAt && (
                  <span className="text-sm text-muted-foreground">
                    Completed: {formatDateTime(session.completedAt)}
                  </span>
                )}
                <span className="text-sm font-medium">
                  Score: {session.correctCount}/{session.totalCards}
                </span>
                {incorrectCount > 0 && (
                  <span className="text-sm text-red-600 dark:text-red-400">
                    {incorrectCount} incorrect
                  </span>
                )}
              </div>
              <a
                href="#summary"
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                Back to top
              </a>
            </div>

            {session.attempts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2 text-left font-medium">#</th>
                      <th className="px-4 py-2 text-left font-medium">Sentence</th>
                      <th className="px-4 py-2 text-left font-medium">Typed Answer</th>
                      <th className="px-4 py-2 text-center font-medium">Result</th>
                      <th className="px-4 py-2 text-right font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.attempts.map((attempt, i) => (
                      <tr
                        key={`${attempt.attemptNumber}-${attempt.attemptedAt}-${i}`}
                        className={cn("border-b last:border-0", i % 2 === 0 && "bg-muted/20")}
                      >
                        <td className="px-4 py-2 text-muted-foreground">{attempt.attemptNumber}</td>
                        <td className="px-4 py-2 font-medium">{attempt.term}</td>
                        <td className="px-4 py-2">{attempt.chosenDefinition}</td>
                        <td className="px-4 py-2 text-center">
                          {attempt.isCorrect ? (
                            <span className="text-emerald-600 dark:text-emerald-400">Correct</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400">Incorrect</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {formatDateTime(attempt.attemptedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">No attempts recorded for this session.</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
