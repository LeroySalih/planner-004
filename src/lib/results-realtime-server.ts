import type { SupabaseClient } from "@supabase/supabase-js"

import {
  ASSIGNMENT_RESULTS_UPDATE_EVENT,
  buildAssignmentResultsChannelName as buildResultsChannelName,
} from "@/lib/results-channel"
import { createSupabaseServiceClient } from "@/lib/supabase/server"

const ASSIGNMENT_CHANNEL_CONFIG = { config: { broadcast: { ack: true } } } as const

export type AssignmentResultsRealtimePayload = {
  submissionId: string | null
  pupilId: string
  activityId: string
  aiScore: number | null
  aiFeedback: string | null
  successCriteriaScores: Record<string, number>
}

export { buildAssignmentResultsChannelName } from "@/lib/results-channel"

export async function publishAssignmentResultsEvents(
  assignmentId: string,
  events: AssignmentResultsRealtimePayload[],
) {
  const supabase = await createSupabaseServiceClient()
  await publishAssignmentResultsEventsWithClient(supabase, assignmentId, events)
}

export async function publishAssignmentResultsEventsWithClient(
  supabase: SupabaseClient,
  assignmentId: string,
  events: AssignmentResultsRealtimePayload[],
) {
  if (!events || events.length === 0) {
    return
  }

  const channelName = buildResultsChannelName(assignmentId)
  const channel = supabase.channel(channelName, ASSIGNMENT_CHANNEL_CONFIG)

  try {
    await subscribeWithAck(channel)

    for (const payload of events) {
      const sendResult = await channel.send({
        type: "broadcast",
        event: ASSIGNMENT_RESULTS_UPDATE_EVENT,
        payload,
      })

      if (sendResult !== "ok") {
        const status =
          typeof sendResult === "string"
            ? sendResult
            : (sendResult as { status?: string })?.status ?? "ok"

        if (status !== "ok") {
          throw new Error(`Assignment results realtime send failed with status: ${status}`)
        }
      }
    }
    console.info("[assignment-results] published realtime events", {
      channelName,
      count: events.length,
    })
  } finally {
    await supabase.removeChannel(channel)
  }
}

async function subscribeWithAck(channel: ReturnType<SupabaseClient["channel"]>) {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const result = channel.subscribe((status) => {
      if (settled) return
      if (status === "SUBSCRIBED") {
        settled = true
        resolve()
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        settled = true
        reject(new Error(`Assignment results realtime channel failed with status: ${status}`))
      }
    })

    if (result instanceof Promise) {
      result.catch((error) => {
        if (!settled) {
          settled = true
          reject(error)
        }
      })
    }
  })
}
