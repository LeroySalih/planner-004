"use server"

import type { SupabaseClient } from "@supabase/supabase-js"

import { createSupabaseServiceClient } from "@/lib/supabase/server"
import { LESSON_CHANNEL_NAME, LESSON_MUTATION_EVENT, type LessonMutationEvent } from "@/lib/lesson-channel"

const LESSON_CHANNEL_CONFIG = { config: { broadcast: { ack: true } } } as const

export async function publishLessonMutationEvent(event: LessonMutationEvent) {
  const supabase = await createSupabaseServiceClient()
  await sendLessonEvent(supabase, event)
}

export async function publishLessonMutationEventWithClient(
  supabase: SupabaseClient,
  event: LessonMutationEvent,
) {
  await sendLessonEvent(supabase, event)
}

async function sendLessonEvent(supabase: SupabaseClient, event: LessonMutationEvent) {
  const channel = supabase.channel(LESSON_CHANNEL_NAME, LESSON_CHANNEL_CONFIG)

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const subscribeResult = channel.subscribe((status) => {
        if (settled) return
        if (status === "SUBSCRIBED") {
          settled = true
          resolve()
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          settled = true
          reject(new Error(`Lesson realtime channel failed with status: ${status}`))
        }
      })

      if (subscribeResult instanceof Promise) {
        subscribeResult.catch((error) => {
          if (!settled) {
            settled = true
            reject(error)
          }
        })
      }
    })

    const sendResult = await channel.send({
      type: "broadcast",
      event: LESSON_MUTATION_EVENT,
      payload: event,
    })

    if (sendResult !== "ok") {
      const status =
        typeof sendResult === "string"
          ? sendResult
          : (sendResult as { status?: string })?.status ?? "ok"

      if (status !== "ok") {
        throw new Error(`Lesson realtime send failed with status: ${status}`)
      }
    }
  } finally {
    await supabase.removeChannel(channel)
  }
}
