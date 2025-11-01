import { promises as fs } from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"

type TelemetryInput<TParams = unknown> = {
  routeTag: string
  functionName: string
  params?: TParams
  authEndTime?: number | null
}

type TelemetryStatus = "ok" | "error"

const LOGS_DIR = path.join(process.cwd(), "logs")
const LOG_FILE_NAME = `telem_${new Date().toISOString().replace(/[:.]/g, "-")}.log`
const LOG_FILE_PATH = path.join(LOGS_DIR, LOG_FILE_NAME)

let ensuredLogDir = false

async function ensureLogDirectory() {
  if (ensuredLogDir) return
  await fs.mkdir(LOGS_DIR, { recursive: true })
  ensuredLogDir = true
}

function resolveTelemetryConfig() {
  const enabled = String(process.env.TELEM_ENABLED ?? "").toLowerCase() === "true"
  const filter = String(process.env.TELEM_PATH ?? "").trim().toLowerCase()
  return { enabled, filter }
}

function shouldRecordTelemetry(routeTag: string) {
  const { enabled, filter } = resolveTelemetryConfig()
  if (!enabled) return false
  if (!filter) return true
  const normalizedTag = routeTag.toLowerCase().replace(/^\/+|\/+$/g, "")
  const normalizedFilter = filter.replace(/^\/+|\/+$/g, "")
  return normalizedTag.includes(normalizedFilter)
}

function buildTelemetryEntry(
  status: TelemetryStatus,
  input: TelemetryInput,
  timings: { start: number; end: number },
  error?: unknown,
) {
  const durationMs = +(timings.end - timings.start).toFixed(3)
  const sinceAuthEndMs =
    typeof input.authEndTime === "number" ? +(timings.end - input.authEndTime).toFixed(3) : null

  return {
    timestamp: new Date().toISOString(),
    status,
    route: input.routeTag,
    functionName: input.functionName,
    params: input.params ?? null,
    durationMs,
    sinceAuthEndMs,
    error:
      status === "error"
        ? error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: "UnknownError", message: String(error) }
        : null,
  }
}

export async function withTelemetry<T>(
  input: TelemetryInput,
  callback: () => Promise<T> | T,
): Promise<T> {
  if (!shouldRecordTelemetry(input.routeTag)) {
    return callback()
  }

  const timings = { start: performance.now(), end: performance.now() }
  let status: TelemetryStatus = "ok"
  let caught: unknown

  try {
    const result = await callback()
    timings.end = performance.now()
    return result
  } catch (error) {
    status = "error"
    caught = error
    timings.end = performance.now()
    throw error
  } finally {
    try {
      await ensureLogDirectory()
      const entry = buildTelemetryEntry(status, input, timings, caught)
      await fs.appendFile(LOG_FILE_PATH, `${JSON.stringify(entry)}\n`, "utf8")
    } catch (writeError) {
      console.error("[telemetry] Failed to write telemetry entry", writeError)
    }
  }
}
