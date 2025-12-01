"use server"

import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { LessonJobResponseSchema } from "@/types"
import { fetchLessonDetailPayload } from "@/lib/lesson-snapshots"
import { publishLessonMutationEventWithClient } from "@/lib/lesson-realtime-server"
import { createSupabaseServiceClient } from "@/lib/supabase/server"

type SnapshotEventOptions = {
  supabase: SupabaseClient
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
  executor: (params: { supabase: SupabaseClient; jobId: string }) => Promise<void>
}) {
  const supabase = await createSupabaseServiceClient()
  const jobId = randomUUID()

  queueMicrotask(() => {
    void runLessonMutationExecutor({
      supabase,
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
  supabase,
  jobId,
  lessonId,
  unitId,
  type,
  message,
  executor,
}: {
  supabase: SupabaseClient
  jobId: string
  lessonId: string
  unitId?: string
  type: string
  message?: string | null
  executor: (params: { supabase: SupabaseClient; jobId: string }) => Promise<void>
}) {
  try {
    await executor({ supabase, jobId })
    await publishLessonSnapshotEvent({
      supabase,
      jobId,
      lessonId,
      unitId,
      type,
      fallbackMessage: message,
    })
  } catch (error) {
    await publishLessonMutationEventWithClient(supabase, {
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
  supabase,
  jobId,
  lessonId,
  unitId,
  type,
  fallbackMessage = null,
}: SnapshotEventOptions) {
  const { data: snapshot, error } = await fetchLessonDetailPayload(lessonId)

  await publishLessonMutationEventWithClient(supabase, {
    job_id: jobId,
    lesson_id: lessonId,
    unit_id: unitId,
    type,
    status: error ? "error" : "completed",
    message: error ?? fallbackMessage,
    data: snapshot,
  })
}
