/**
 * Next.js instrumentation hook — runs once when a server instance boots.
 * We use it to fail fast on a misconfigured environment before serving any
 * traffic (see src/lib/env/required-env.ts for the manifest), and to start
 * the Message Batches driver.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime has the full env + fs access; skip the Edge
  // (middleware) runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Do not halt the production build: runtime secrets are injected at `next
  // start`, not at build time, so enforcing here would break `next build`.
  if (process.env.NEXT_PHASE === "phase-production-build") return

  const { assertRequiredEnv } = await import("./lib/env/assert-env")
  assertRequiredEnv()

  // Message Batches for question marking: submit and poll while any batch
  // work is open (src/lib/ai/batch-driver.ts).
  const { startBatchDriver } = await import("./lib/ai/batch-driver")
  startBatchDriver()
}
