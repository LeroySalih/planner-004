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
  "AI_MARKING_CALLBACK_URL", // callback origin for async marking results

  // MCP server
  "MCP_SERVICE_KEY", // src/lib/mcp/auth.ts — MCP bearer/service key

  // n8n integrations (webhook URL + its auth header, per feature)
  "N8N_MARKING_WEBHOOK_URL",
  "N8N_MARKING_AUTH",
  "N8N_MARK_WORKSHEET_WEBHOOK_URL",
  "N8N_MARK_WORKSHEET_AUTH",
  "N8N_OCR_WEBHOOK_URL",
  "N8N_OCR_AUTH",

  // OCR / scoring
  "IMAGE_OCR_SERVICE_KEY", // src/app/webhooks/image-to-text/route.ts
  "OPEN_AI_KEY", // src/lib/ai/short-text-scoring.ts

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
  ["GOOGLE_API_KEY", "GEMINI_API_KEY"], // Gemini/Google AI key (lesson+unit chat, OCR, sketch)
  ["MARK_SERVICE_KEY", "AI_MARK_SERVICE_KEY"], // ai-mark webhook service key
  ["AI_MARK_URL", "NEXT_PUBLIC_AI_MARK_URL"], // ai-mark endpoint
  ["AI_MARK_WEBHOOK_URL", "NEXT_PUBLIC_AI_MARK_WEBHOOK_URL"], // ai-mark webhook
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
