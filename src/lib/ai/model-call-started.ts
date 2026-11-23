import { AsyncLocalStorage } from "node:async_hooks"

// "This job's model response has begun": the signal cache-warm-order.ts waits
// for before it starts the next mark job of the same hand-in. An Anthropic
// prompt-cache entry is readable once the response that wrote it has begun
// streaming, so the next job need not wait for the whole reply.
//
// Carried in async context rather than through every caller, so the markers
// and the model client keep their signatures: the worker runs a job inside
// runNotifyingModelStart, and the transport calls modelResponseStarted.
//
// No server-only: the checks import it directly.

const listener = new AsyncLocalStorage<() => void>()

/** Run `fn`; `onStart` is called (perhaps more than once) when a model response it waits for begins. */
export function runNotifyingModelStart<T>(onStart: () => void, fn: () => Promise<T>): Promise<T> {
  return listener.run(onStart, fn)
}

/** True when the caller waits for the response to begin (the transport then streams the reply). */
export function wantsModelStart(): boolean {
  return listener.getStore() !== undefined
}

/** Tell the waiting caller, if any, that the model response has begun. */
export function modelResponseStarted(): void {
  listener.getStore()?.()
}
