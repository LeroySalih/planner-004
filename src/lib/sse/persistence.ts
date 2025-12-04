import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"

import type { SseEmitInput, SseEventEnvelope, SseTopic } from "./types"

const DEFAULT_LIMIT = 50

export async function persistSseEvent(input: SseEmitInput): Promise<SseEventEnvelope> {
  return withTelemetry(
    { routeTag: "/sse", functionName: "persistSseEvent", params: { topic: input.topic, type: input.type } },
    async () => {
      const { rows } = await query<{
        id: string
        created_at: string
        topic: SseTopic
        event_type: string
        payload: Record<string, unknown>
        emitted_by: string | null
      }>(
        `insert into sse_events (topic, event_type, payload, emitted_by)
         values ($1, $2, $3, $4)
         returning id, created_at, topic, event_type, payload, emitted_by`,
        [input.topic, input.type, input.payload, input.emittedBy ?? null],
      )

      const row = rows[0]
      return {
        id: row.id,
        createdAt: new Date(row.created_at).toISOString(),
        topic: row.topic,
        type: row.event_type,
        payload: row.payload ?? {},
        emittedBy: row.emitted_by,
      }
    },
  )
}

export async function fetchRecentSseEvents(topics: SseTopic[], limit = DEFAULT_LIMIT) {
  if (topics.length === 0) {
    return []
  }

  return withTelemetry(
    { routeTag: "/sse", functionName: "fetchRecentSseEvents", params: { topics, limit } },
    async () => {
      const { rows } = await query<{
        id: string
        created_at: string
        topic: SseTopic
        event_type: string
        payload: Record<string, unknown>
        emitted_by: string | null
      }>(
        `select id, created_at, topic, event_type, payload, emitted_by
         from sse_events
         where topic = any($1::text[])
         order by created_at desc
        limit $2`,
        [topics, Math.max(1, limit)],
      )

      return rows
        .map((row) => ({
          id: row.id,
          createdAt: new Date(row.created_at).toISOString(),
          topic: row.topic,
          type: row.event_type,
          payload: row.payload ?? {},
          emittedBy: row.emitted_by,
        }))
        .reverse()
    },
  )
}

export async function fetchLatestSseEvent(topic: SseTopic) {
  const events = await fetchRecentSseEvents([topic], 1)
  return events.at(-1) ?? null
}
