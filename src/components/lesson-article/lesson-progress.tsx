"use client"

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { addFeedbackRefreshListener } from "@/lib/feedback-events"

type LessonProgress = {
  /** Activities the pupil has answered, updated as answers save. */
  done: ReadonlySet<string>
  /** The activities that count towards progress. */
  countable: ReadonlySet<string>
}

const LessonProgressContext = createContext<LessonProgress>({ done: new Set(), countable: new Set() })

/**
 * Which of the lesson's answerable activities have an answer. Starts from the
 * server's submissions and adds each activity whose answer saves, so the
 * contents markers and progress bar move without a reload.
 */
export function LessonProgressProvider({
  lessonId,
  countableIds,
  initialDoneIds,
  children,
}: {
  lessonId: string
  countableIds: string[]
  initialDoneIds: string[]
  children: ReactNode
}) {
  const countable = useMemo(() => new Set(countableIds), [countableIds])
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set(initialDoneIds))

  useEffect(() => {
    setDone(new Set(initialDoneIds))
  }, [initialDoneIds])

  useEffect(
    () =>
      addFeedbackRefreshListener((eventLessonId, activityId) => {
        if (!activityId || (eventLessonId && eventLessonId !== lessonId)) return
        setDone((previous) => (previous.has(activityId) ? previous : new Set(previous).add(activityId)))
      }),
    [lessonId],
  )

  const value = useMemo(() => ({ done, countable }), [done, countable])
  return <LessonProgressContext.Provider value={value}>{children}</LessonProgressContext.Provider>
}

export function useLessonProgress() {
  const { done, countable } = useContext(LessonProgressContext)
  const doneCount = [...countable].filter((id) => done.has(id)).length
  return { done, countable, doneCount, total: countable.size }
}
