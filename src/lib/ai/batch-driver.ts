// Drives Message Batches for question marking (message-batches.ts) in the
// running server, with no cron and no other process: once a minute, if any
// batch work is open (a parked item or a batch not yet handled), one tick
// submits what is parked and polls the batches that are due. When the tick
// handled results or released jobs, the queue processor is triggered, as any
// new marking work triggers it, so those jobs run now.
//
// Started from instrumentation.ts in each Node.js server process. Several
// processes (PM2) may tick together: items and batches are claimed row by
// row, so nothing is submitted or applied twice.

/** How often the driver looks for open batch work. */
export const BATCH_TICK_MS = 60_000

const DRIVER = Symbol.for("dino.messageBatchDriver")

export function startBatchDriver(): void {
  const holder = globalThis as unknown as Record<symbol, ReturnType<typeof setInterval> | undefined>
  if (holder[DRIVER]) return
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    void (async () => {
      try {
        const { runBatchTick, triggerQueueProcessor } = await import("@/lib/ai/marking-queue")
        const tick = await runBatchTick()
        if (tick.wake) await triggerQueueProcessor()
      } catch (error) {
        console.error("[batch-driver] Message Batch tick failed:", error)
      } finally {
        running = false
      }
    })()
  }, BATCH_TICK_MS)
  timer.unref?.()
  holder[DRIVER] = timer
}
