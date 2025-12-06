"use server"

import { randomUUID } from "node:crypto"

import { LessonJobResponseSchema } from "@/types"
import { fetchLessonDetailPayload } from "@/lib/lesson-snapshots"
import { emitLessonEvent } from "@/lib/sse/topics"

type SnapshotEventOptions = {
  jobId: string
  lessonId: string
  unitId?: string
  type: string
  fallbackMessage?: string | null
}

export async function enqueueLessonMutationJob({
  lessonId,
  unitId,
  type,
  message,
  executor,
}: {
  lessonId: string
  unitId?: string
  type: string
  message?: string | null
  executor: (params: { jobId: string }) => Promise<void>
}) {
  const jobId = randomUUID()

  queueMicrotask(() => {
    void runLessonMutationExecutor({
      jobId,
      lessonId,
      unitId,
      type,
      message,
      executor,
    })
  })

  return LessonJobResponseSchema.parse({
    status: "queued",
    jobId,
    message: message ?? "Lesson update queued.",
  })
}

async function runLessonMutationExecutor({
  jobId,
  lessonId,
  unitId,
  type,
  message,
  executor,
}: {
  jobId: string
  lessonId: string
  unitId?: string
  type: string
  message?: string | null
  executor: (params: { jobId: string }) => Promise<void>
}) {
  try {
    await executor({ jobId })
    await publishLessonSnapshotEvent({
      jobId,
      lessonId,
      unitId,
      type,
      fallbackMessage: message,
    })
  } catch (error) {
    await emitLessonEvent("lesson.mutation", {
      job_id: jobId,
      lesson_id: lessonId,
      unit_id: unitId,
      type,
      status: "error",
      message: error instanceof Error ? error.message : "Lesson mutation failed",
    })
  }
}

export async function publishLessonSnapshotEvent({
  jobId,
  lessonId,
  unitId,
  type,
  fallbackMessage = null,
}: SnapshotEventOptions) {
  const { data: snapshot, error } = await fetchLessonDetailPayload(lessonId)

  await emitLessonEvent("lesson.mutation", {
    job_id: jobId,
    lesson_id: lessonId,
    unit_id: unitId,
    type,
    status: error ? "error" : "completed",
    message: error ?? fallbackMessage,
    data: snapshot,
  })
}
