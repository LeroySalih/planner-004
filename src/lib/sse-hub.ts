type SseMessage =
  | {
      type: "counter"
      value: number
    }

type SseClient = {
  id: string
  controller: ReadableStreamDefaultController<Uint8Array>
}

type SseHubState = {
  clients: Set<SseClient>
  counter: number
}

declare global {
  // eslint-disable-next-line no-var
  var __plannerSseHub: SseHubState | undefined
}

const encoder = new TextEncoder()

function getHub(): SseHubState {
  if (!globalThis.__plannerSseHub) {
    globalThis.__plannerSseHub = {
      clients: new Set<SseClient>(),
      counter: 0,
    }
  }
  return globalThis.__plannerSseHub
}

function toSsePayload(message: SseMessage) {
  return encoder.encode(`data: ${JSON.stringify(message)}\n\n`)
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

export function getCurrentCounter() {
  return getHub().counter
}

export function incrementCounter() {
  const hub = getHub()
  hub.counter += 1
  const payload = toSsePayload({ type: "counter", value: hub.counter })

  for (const client of hub.clients) {
    try {
      client.controller.enqueue(payload)
    } catch (error) {
      console.warn("[sse] failed to push event to client", client.id, error)
      removeClient(client, "enqueue-error")
    }
  }

  return hub.counter
}

export function registerSseClient(signal?: AbortSignal) {
  const hub = getHub()
  let client: SseClient | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = { id: crypto.randomUUID(), controller }
      hub.clients.add(client)
      controller.enqueue(toSsePayload({ type: "counter", value: hub.counter }))
      signal?.addEventListener("abort", () => removeClient(client, "abort"))
    },
    cancel() {
      removeClient(client, "cancel")
    },
  })

  return stream
}
