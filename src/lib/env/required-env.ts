/**
 * Single source of truth for the environment variables the app requires at
 * startup. Kept as a pure module (no side effects) so it can be imported by the
 * startup asserter, a standalone `pnpm check:env` script, or tests.
 *
 * Enforcement policy: STRICT — every variable the code reads via `process.env`
 * is required, EXCEPT pure feature-flags/toggles that have sensible defaults
 * (listed in IGNORED_FLAGS below for documentation only).
 *
 * Where a variable pair is read with a fallback (`A ?? B`), the pair lives in
 * REQUIRED_ONE_OF: at least one of the two must be present.
 *
 * Presence rule: a variable "has a value" only if it is a non-empty string
 * after trimming — a blank `FOO=` counts as missing.
 */

/** Required singletons — each must be present and non-empty. */
export const REQUIRED_ENV: readonly string[] = [
  // Core
  "DATABASE_URL", // src/lib/db.ts + api routes — Postgres connection
  "APP_URL", // src/lib/server-actions/auth.ts — canonical app origin

  // Marking pipeline
  "MARKING_QUEUE_SECRET", // guards /api/marking/process-queue + /api/jobs/process
  "AI_MARKING_CALLBACK_URL", // the app's own origin, used to self-trigger the queue processor

  // MCP server
  "MCP_SERVICE_KEY", // src/lib/mcp/auth.ts — MCP bearer/service key

  // PDF rendering (Gotenberg)
  "GOTENBERG_URL",
  "GOTENBERG_USERNAME",
  "GOTENBERG_PASSWORD",
] as const

/**
 * "One of" groups — the code reads these as `A ?? B`, so at least one member of
 * each group must be present. (Server-side name is preferred; the NEXT_PUBLIC_*
 * variant is the build-inlined fallback.)
 */
export const REQUIRED_ONE_OF: readonly (readonly string[])[] = [
  // Gemini/Google AI key — marking, OCR, sketch render and image generation
  ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  // Anthropic key — lesson chat and unit chat call Claude, so a missing key
  // takes both authoring surfaces down. CLAUDE_API_KEY is the name this
  // deployment uses; ANTHROPIC_API_KEY is the one the SDK reads unaided.
  ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY"],
] as const

/**
 * Pure flags/toggles with in-code defaults — intentionally NOT enforced.
 * Listed only so this file documents every `process.env` reference in the app.
 */
export const IGNORED_FLAGS: readonly string[] = [
  "NODE_ENV",
  "MAINTENANCE_MODE",
  "MAINTENANCE_BYPASS",
  "TELEM_ENABLED",
  "TELEM_PATH",
  "NEXT_PUBLIC_RESULTS_REALTIME_ENABLED",
  "NEXT_PUBLIC_APP_URL",
] as const

export type EnvCheckResult = {
  ok: boolean
  /** Required singletons that are absent or empty. */
  missing: string[]
  /** One-of groups where no member is present. */
  missingGroups: string[][]
}

function hasValue(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name]
  return typeof value === "string" && value.trim().length > 0
}

/**
 * Validate the environment against the manifest. Pure — returns the full set of
 * problems (never throws, never logs), so callers decide how to react.
 */
export function checkRequiredEnv(env: NodeJS.ProcessEnv = process.env): EnvCheckResult {
  const missing = REQUIRED_ENV.filter((name) => !hasValue(env, name))
  const missingGroups = REQUIRED_ONE_OF
    .filter((group) => !group.some((name) => hasValue(env, name)))
    .map((group) => [...group])
  return { ok: missing.length === 0 && missingGroups.length === 0, missing, missingGroups }
}
