import Link from "next/link"
import { format, parseISO, addWeeks } from "date-fns"
import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { readPupilTasksAction } from "@/lib/server-updates"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

function formatDate(value: string | null) {
  if (!value) return "No date set"
  try {
    return format(parseISO(value), "dd-MM-yyyy")
  } catch {
    return value
  }
}

function formatDueDate(startDate: string | null) {
  if (!startDate) return "No due date"
  try {
    return format(addWeeks(parseISO(startDate), 1), "dd-MM-yyyy")
  } catch {
    return startDate
  }
}

export default async function TasksPage() {
  const profile = await requireAuthenticatedProfile()
  const result = await readPupilTasksAction(profile.userId)

  const groups = result.data ?? []
  const totalTasks = groups.reduce((sum, group) => sum + group.tasks.length, 0)

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-6 text-white shadow-lg sm:px-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">My Tasks</h1>
          <p className="text-sm text-amber-100 sm:text-base">
            Activities that need your attention, grouped by subject.
          </p>
        </div>
      </header>

      {totalTasks === 0 ? (
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-lg font-semibold text-green-700 dark:text-green-400">
              All caught up - no tasks to complete
            </p>
            <p className="text-sm text-green-600 dark:text-green-500">
              Check back later for new tasks from your teachers.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.subject} className="space-y-4">
              <h2 className="text-2xl font-semibold text-foreground">{group.subject}</h2>
              <div className="space-y-3">
                {group.tasks.map((task, index) => (
                  <Link
                    key={`${task.lessonId}-${task.activityId ?? index}`}
                    href={`/pupil-lessons/${encodeURIComponent(profile.userId)}/lessons/${encodeURIComponent(task.lessonId)}`}
                    className="block"
                  >
                    <Card className="transition-colors hover:border-primary/50 hover:shadow-md">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <CardTitle className="text-base font-semibold">
                              {task.lessonTitle}
                            </CardTitle>
                            <p className="text-xs text-muted-foreground">{task.unitTitle}</p>
                          </div>
                          {task.type === "resubmit" ? (
                            <Badge variant="outline" className="shrink-0 gap-1 border-amber-500 text-amber-600">
                              <RotateCcw className="h-3 w-3" />
                              Resubmit
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="shrink-0 gap-1 border-red-500 text-red-600">
                              <AlertTriangle className="h-3 w-3" />
                              Needs work
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {task.type === "resubmit" ? (
                          <div className="space-y-1">
                            {task.activityTitle && (
                              <p className="text-sm text-foreground">
                                Activity: {task.activityTitle}
                              </p>
                            )}
                            {task.resubmitNote && (
                              <p className="text-sm text-amber-600 dark:text-amber-400">
                                &ldquo;{task.resubmitNote}&rdquo;
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Score: {task.lessonScore != null && task.lessonMaxScore != null && task.lessonMaxScore > 0
                              ? `${Math.round((task.lessonScore / task.lessonMaxScore) * 100)}%`
                              : "—"
                            } · Due: {formatDueDate(task.startDate)}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
