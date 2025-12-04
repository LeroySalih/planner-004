import { persistSseEvent } from "@/lib/sse/persistence"

import type { SseEmitInput, SseEventEnvelope, SseTopic } from "./types"

type SseClient = {
  id: string
  topics: Set<SseTopic>
  controller: ReadableStreamDefaultController<Uint8Array>
}

type HubState = {
  clients: Set<SseClient>
  topicCounters: Map<SseTopic, number>
}

declare global {
  // eslint-disable-next-line no-var
  var __plannerSseHub: HubState | undefined
}

const encoder = new TextEncoder()
const DEFAULT_KEEP_ALIVE_MS = 25_000

function getHub(): HubState {
  if (!globalThis.__plannerSseHub) {
    globalThis.__plannerSseHub = {
      clients: new Set<SseClient>(),
      topicCounters: new Map<SseTopic, number>(),
    }
  }
  return globalThis.__plannerSseHub
}

function toSseChunk(event: SseEventEnvelope) {
  return encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)
}

function toPingChunk() {
  return encoder.encode(`: ping ${Date.now()}\n\n`)
}

function removeClient(client: SseClient | null, reason?: string) {
  if (!client) return
  getHub().clients.delete(client)
  try {
    client.controller.close()
  } catch (error) {
    console.warn("[sse] failed to close client", reason, error)
  }
}

function broadcast(event: SseEventEnvelope) {
  const hub = getHub()
  for (const client of hub.clients) {
    if (!client.topics.has(event.topic)) continue
    try {
      client.controller.enqueue(toSseChunk(event))
    } catch (error) {
      console.warn("[sse] failed to enqueue event", event.topic, error)
      removeClient(client, "enqueue-error")
    }
  }
}

export function getTopicCounter(topic: SseTopic) {
  return getHub().topicCounters.get(topic) ?? 0
}

export function incrementTopicCounter(topic: SseTopic) {
  const hub = getHub()
  const nextValue = (hub.topicCounters.get(topic) ?? 0) + 1
  hub.topicCounters.set(topic, nextValue)
  return nextValue
}

export function setTopicCounter(topic: SseTopic, value: number) {
  getHub().topicCounters.set(topic, value)
}

export async function emitSseEvent(input: SseEmitInput): Promise<SseEventEnvelope> {
  const persisted = await persistSseEvent(input)
  broadcast(persisted)
  return persisted
}

export function registerSseClient(
  topics: SseTopic[],
  options?: {
    signal?: AbortSignal
    initialEvents?: SseEventEnvelope[]
    keepAliveMs?: number
  },
) {
  const hub = getHub()
  let client: SseClient | null = null
  const keepAliveMs = options?.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = {
        id: crypto.randomUUID(),
        topics: new Set(topics),
        controller,
      }

      hub.clients.add(client)

      if (options?.initialEvents) {
        options.initialEvents.forEach((event) => controller.enqueue(toSseChunk(event)))
      }

      const keepAliveId =
        keepAliveMs > 0 ? setInterval(() => controller.enqueue(toPingChunk()), keepAliveMs) : null

      const cleanup = (reason?: string) => {
        if (keepAliveId) clearInterval(keepAliveId)
        removeClient(client, reason)
      }

      options?.signal?.addEventListener("abort", () => cleanup("abort"), { once: true })

      controller.enqueue(toPingChunk())
    },
    cancel() {
      removeClient(client, "cancel")
    },
  })

  return stream
}
