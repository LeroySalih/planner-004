import { runNotifyingModelStart } from "@/lib/ai/model-call-started"

// Run a claimed batch so that the prompt cache is warm for most of it.
//
// A practical assessment's mark jobs for one hand-in share their opening
// (system text, then the pupil's report sections: powerpoint-assessment
// marking.ts, reportParts), and Anthropic serves a cached prefix only to a
// request sent after the response that wrote it has begun: requests sent
// together all miss, and each pays the cache-write price. So the jobs of one
// group (one submission's practical mark jobs) are staggered: each starts once
// the previous one's model response has begun (model-call-started.ts: the
// Anthropic transport streams the reply and signals at its first event, the
// Gemini one signals at once), or that job has finished, or STAGGER_MAX_WAIT_MS
// has passed. Groups, and jobs with no group, run alongside each other as
// before. So a job finds every earlier job's prefix in the cache, as if they
// ran one by one, and a batch takes about one call plus a few times the time
// to the first token, not five calls.
//
// Pure apart from the async context: no database, no server-only.

/** The longest a job waits for the one before it to begin its response. */
export const STAGGER_MAX_WAIT_MS = 30_000

/**
 * Run every item; within a group, each after the one before it has begun its
 * model response (or finished). `groupKey` null: no group, run at once.
 * Returns the settled results in the items' order, as Promise.allSettled
 * would.
 */
export async function runCacheStaggered<T, R>(
  items: T[],
  groupKey: (item: T) => string | null,
  run: (item: T) => Promise<R>,
  options: { maxWaitMs?: number } = {},
): Promise<PromiseSettledResult<R>[]> {
  const maxWaitMs = options.maxWaitMs ?? STAGGER_MAX_WAIT_MS
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  const settle = (index: number, promise: Promise<R>) =>
    promise.then(
      (value) => {
        results[index] = { status: "fulfilled", value }
      },
      (reason: unknown) => {
        results[index] = { status: "rejected", reason }
      },
    )

  /** Start one item; resolves `begun` when its response begins, it finishes, or the wait runs out. */
  const start = (index: number) => {
    let signal!: () => void
    const started = new Promise<void>((resolve) => {
      signal = resolve
    })
    const done = settle(index, runNotifyingModelStart(() => signal(), () => run(items[index])))
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, maxWaitMs)
    })
    const begun = Promise.race([started, done, timeout]).finally(() => clearTimeout(timer))
    return { begun, done }
  }

  const groups = new Map<string, number[]>()
  const lanes: Promise<unknown>[] = []
  items.forEach((item, index) => {
    const key = groupKey(item)
    if (key === null) {
      lanes.push(settle(index, run(item)))
      return
    }
    const group = groups.get(key)
    if (group) group.push(index)
    else groups.set(key, [index])
  })
  for (const group of groups.values()) {
    lanes.push((async () => {
      const done: Promise<void>[] = []
      for (const index of group) {
        const job = start(index)
        done.push(job.done)
        await job.begun
      }
      await Promise.all(done)
    })())
  }
  await Promise.all(lanes)
  return results
}
