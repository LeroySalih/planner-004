/**
 * Startup guard: verifies all required environment variables are present and
 * halts the process if any are missing. Called once from `src/instrumentation.ts`
 * when the Node.js server boots.
 *
 * On failure it writes the reason + missing variable NAMES (never their values)
 * to both the console and `logs/startup-env-check.log`, then exits with code 1
 * so the server does not come up in a misconfigured state.
 *
 * Synchronous fs is used deliberately: the log must be flushed before
 * `process.exit`, which does not wait for pending async writes.
 */
import { appendFileSync, mkdirSync } from "node:fs"
import path from "node:path"

import { checkRequiredEnv } from "./required-env"

const LOGS_DIR = path.join(process.cwd(), "logs")
const LOG_FILE = path.join(LOGS_DIR, "startup-env-check.log")

function writeLog(lines: string[]): void {
  try {
    mkdirSync(LOGS_DIR, { recursive: true })
    const stamp = new Date().toISOString()
    const body = lines.map((line) => `${stamp} ${line}`).join("\n") + "\n"
    appendFileSync(LOG_FILE, body, "utf8")
  } catch (error) {
    // Never let a logging failure mask the real (env) problem.
    console.error("[env-check] could not write startup log:", (error as Error).message)
  }
}

/**
 * Assert the environment or stop the server. Safe to call multiple times; only
 * acts on failure.
 */
export function assertRequiredEnv(env: NodeJS.ProcessEnv = process.env): void {
  const { ok, missing, missingGroups } = checkRequiredEnv(env)

  if (ok) {
    console.log("[env-check] ✓ all required environment variables are present")
    return
  }

  const problems: string[] = [
    ...missing.map((name) => `MISSING required env var: ${name}`),
    ...missingGroups.map(
      (group) => `MISSING required env var: at least one of [${group.join(", ")}] must be set`,
    ),
  ]

  const header = `[env-check] FATAL: ${problems.length} environment problem(s) — server will not start`

  // Console (stderr)
  console.error("")
  console.error(header)
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error("[env-check] Set the missing variable(s) in .env and restart. Values are hidden for security.")
  console.error("")

  // Log file
  writeLog([header, ...problems.map((problem) => `  - ${problem}`)])

  process.exit(1)
}
