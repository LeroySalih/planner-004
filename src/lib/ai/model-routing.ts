import "server-only"

import { query } from "@/lib/db"
import {
  type AiEffort,
  type AiModelRoute,
  type AiProvider,
  AiModelRouteSchema,
} from "@/types"

/**
 * Which model marks which activity.
 *
 * Before this, every marking call went through defaultMarkingModel() — one
 * model for the whole app. That is the wrong granularity in both directions: a
 * binary 0/1 criterion does not need the same model as a levelled 0..n one, and
 * a worksheet photo needs high-resolution vision that a short-text question
 * does not.
 *
 * Routes live in the ai_model_routes table and are edited at /admin/ai-models.
 * API keys are NOT here — they stay in .env (see CLAUDE.md § Security).
 */

export interface ModelChoice {
  provider: AiProvider
  model: string
  /** Anthropic only; ignored for google. */
  effort: AiEffort | null
  /**
   * Send by Message Batch (migration 152). True only on a BATCH_ROUTE_KEYS
   * row whose provider is anthropic and whose switch is on; never on
   * DEFAULT_ROUTE.
   */
  useBatch?: boolean
}

export interface CatalogueEntry extends ModelChoice {
  label: string
  /**
   * What the model produces. A surface asking for images must not be offered a
   * text model, and vice versa — the two are not interchangeable, and a
   * mismatch fails at call time with a provider-specific error.
   */
  kind: "text" | "image"
  /**
   * Max long edge the model sees. "high" = 2576px/4784 visual tokens,
   * "standard" = 1568px/1568. Decisive for photographed pupil work: handwriting
   * is where the lower tier costs you.
   */
  visionTier: "high" | "standard"
  /** USD per million tokens, for display only. See PRICING_AS_OF. */
  inputPerMTok: number
  outputPerMTok: number
  note: string
  /**
   * Whether the app can actually call this model today.
   *
   * Every current entry is callable — callModel dispatches on provider — but the
   * flag stays so a model can be listed before its transport exists, rather than
   * being selectable and failing deep in the queue.
   */
  available: boolean
}

/**
 * Published list prices drift. The UI shows this date next to the figures so
 * nobody reads them as live billing data.
 */
export const PRICING_AS_OF = "2026-06-24"

export const MODEL_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
  {
    provider: "google",
    model: "gemini-flash-latest",
    effort: null,
    label: "Gemini Flash (latest)",
    kind: "text",
    visionTier: "standard",
    inputPerMTok: 0,
    outputPerMTok: 0,
    note: "Current default. Cheapest, but geo-blocked from Saudi Arabia.",
    available: true,
  },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    effort: null,
    label: "Claude Haiku 4.5",
    kind: "text",
    visionTier: "standard",
    inputPerMTok: 1,
    outputPerMTok: 5,
    note: "Cheapest Claude. Standard-resolution vision — fine for typed text, weaker on handwriting.",
    available: true,
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-5",
    effort: null,
    label: "Claude Sonnet 5",
    kind: "text",
    visionTier: "high",
    inputPerMTok: 3,
    outputPerMTok: 15,
    note: "Same high-resolution vision as Opus at 60% of the price. The sensible default for photo marking.",
    available: true,
  },
  {
    provider: "anthropic",
    model: "claude-opus-5",
    effort: null,
    label: "Claude Opus 5",
    kind: "text",
    visionTier: "high",
    inputPerMTok: 5,
    outputPerMTok: 25,
    note: "Most capable. Worth it where judgement is genuinely hard; try Sonnet 5 first.",
    available: true,
  },
  {
    provider: "google",
    model: "gemini-3-pro-image-preview",
    effort: null,
    label: "Gemini 3 Pro Image (preview)",
    kind: "image",
    visionTier: "standard",
    inputPerMTok: 0,
    outputPerMTok: 0,
    note: "Image generation. Geo-blocked from Saudi Arabia — see IMAGE_GENERATION_ENABLED.",
    available: true,
  },
  {
    provider: "google",
    model: "gemini-3.1-flash-image",
    effort: null,
    label: "Gemini 3.1 Flash Image",
    kind: "image",
    visionTier: "standard",
    inputPerMTok: 0,
    outputPerMTok: 0,
    note: "Faster image generation. Geo-blocked from Saudi Arabia.",
    available: true,
  },
])

/**
 * Model-using surfaces that are not activity types.
 *
 * They share the ai_model_routes table — `activity_type` holds the surface key —
 * so there is one place to look and one admin screen, rather than a second
 * mechanism that drifts. Keys are prefixed to keep them unambiguous against
 * real activity types.
 */
export interface ModelSurface {
  key: string
  label: string
  description: string
  kind: "text" | "image"
  /**
   * Providers this surface can actually run on, when that is narrower than its
   * `kind` implies. Marking works on either provider because callModel
   * dispatches; the chats do not, because they need multi-turn history and only
   * the Anthropic transport carries it. Omit when any provider of the right
   * kind will do.
   */
  providers?: readonly AiProvider[]
  /**
   * What the admin screen shows when the surface has no row. Omit for
   * "built-in default"; set it where an unset surface falls back to another
   * route instead (the text-marking surfaces fall back to the activity's).
   */
  unsetLabel?: string
}

export const MODEL_SURFACES: readonly ModelSurface[] = Object.freeze([
  {
    key: "surface:lesson-chat",
    providers: ["anthropic"],
    label: "Lesson chat",
    description: "Develop with AI on a lesson",
    kind: "text",
  },
  {
    key: "surface:unit-chat",
    providers: ["anthropic"],
    label: "Unit chat",
    description: "Develop with AI on a unit",
    kind: "text",
  },
  {
    key: "surface:worksheet-ocr",
    label: "Worksheet transcription",
    description: "Reads pupil worksheets before upload-worksheet marking",
    kind: "text",
  },
  {
    key: "surface:assessment-read",
    label: "Assessment paper read",
    description: "Reads each pupil's assessment paper script, question by question, before it is marked",
    kind: "text",
  },
  {
    key: "surface:assessment-mark-text",
    label: "Assessment paper: text answers",
    description: "Marks the assessment paper answers the reader read as typed or handwritten text, with their page images. Sketches, mixed and unreadable answers use the assessment-paper route",
    kind: "text",
    unsetLabel: "— the assessment-paper route —",
  },
  {
    key: "surface:powerpoint-mark-text",
    label: "PowerPoint assessment: text-only questions",
    description: "Marks the PowerPoint assessment questions whose evidence sends no pictures (the presentation report, typed text, a reference file). Questions with slide pictures, PDFs or screenshots use the powerpoint-assessment route",
    kind: "text",
    unsetLabel: "— the powerpoint-assessment route —",
  },
  {
    key: "surface:database-mark-text",
    label: "Database assessment: text-only questions",
    description: "Marks the database assessment questions whose evidence sends no pictures (the database report, typed text, a reference file). Questions with PDFs or screenshots use the database-assessment route",
    kind: "text",
    unsetLabel: "— the database-assessment route —",
  },
  {
    key: "surface:assessment-mark-scheme",
    label: "Assessment mark scheme split",
    description: "Splits an assessment paper's mark scheme PDF into per-question text for the teacher to review",
    kind: "text",
  },
  {
    key: "surface:handwriting-ocr",
    label: "Handwriting extraction",
    description: "The standalone /ocr tool",
    kind: "text",
  },
  {
    key: "surface:sketch-guardrail",
    label: "Sketch guardrail",
    description: "Checks a pupil sketch prompt before rendering",
    kind: "text",
  },
  {
    key: "surface:image-generation",
    providers: ["google"],
    label: "Image generation",
    description: "Sketch render and AI-proposed lesson images (mothballed)",
    kind: "image",
  },
])

/**
 * The route keys whose use_batch switch has effect (migration 152): the
 * question-marked types' activity routes, and the surfaces of the paper's
 * read and of the text-marking routes. Every other key ignores the switch,
 * and so does a row whose provider is not anthropic.
 */
export const BATCH_ROUTE_KEYS: readonly string[] = Object.freeze([
  "assessment-paper",
  "powerpoint-assessment",
  "database-assessment",
  "surface:assessment-read",
  "surface:assessment-mark-text",
  "surface:powerpoint-mark-text",
  "surface:database-mark-text",
])

/** Why the batch switch cannot be on for this key and provider, or null. */
export function batchSwitchProblem(key: string, provider: string): string | null {
  if (!BATCH_ROUTE_KEYS.includes(key)) return `${key} cannot be marked by batch.`
  if (provider !== "anthropic") return "Only Claude models can be sent by batch."
  return null
}

/** The surface a key names, or null when the key is an activity type. */
export function findModelSurface(key: string): ModelSurface | null {
  return MODEL_SURFACES.find((surface) => surface.key === key) ?? null
}

export function findCatalogueEntry(provider: string, model: string): CatalogueEntry | null {
  return (
    MODEL_CATALOGUE.find((entry) => entry.provider === provider && entry.model === model) ?? null
  )
}

/**
 * Used when the table has no matching row — including before migration 088 is
 * applied. Deliberately identical to the old defaultMarkingModel() so an
 * unconfigured install behaves exactly as it did before this feature.
 */
export const DEFAULT_ROUTE: ModelChoice = Object.freeze({
  provider: "google",
  model: process.env.GEMINI_MARKING_MODEL ?? "gemini-flash-latest",
  effort: null,
})

function cacheKey(activityType: string, scType: string | null): string {
  return `${activityType}::${scType ?? "*"}`
}

/**
 * Per-criterion marking fans out N calls per submission, so resolving from the
 * database once per call would mean N round trips for a value that changes
 * perhaps monthly. Cached in-process with a short TTL rather than indefinitely:
 * the queue worker is long-lived, and under PM2 there may be several of them,
 * so an admin edit has to reach them without a restart. Thirty seconds bounds
 * how long a route change takes to apply.
 */
const CACHE_TTL_MS = 30_000
let cache: { loadedAt: number; routes: Map<string, ModelChoice> } | null = null

export function invalidateModelRouteCache(): void {
  cache = null
}

async function loadRoutes(): Promise<Map<string, ModelChoice>> {
  const now = Date.now()
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.routes
  }

  const routes = new Map<string, ModelChoice>()
  try {
    const { rows } = await query(
      `select route_id, activity_type, sc_type, provider, model, effort, active, use_batch,
              updated_at::text as updated_at, updated_by
         from ai_model_routes
        where active`,
    )
    for (const row of rows) {
      const parsed = AiModelRouteSchema.safeParse(row)
      if (!parsed.success) {
        console.error("[model-routing] Skipping unparseable route row:", parsed.error)
        continue
      }
      const route = parsed.data
      routes.set(cacheKey(route.activity_type, route.sc_type), {
        provider: route.provider,
        model: route.model,
        effort: route.effort,
        useBatch: route.use_batch && route.sc_type === null && batchSwitchProblem(route.activity_type, route.provider) === null,
      })
    }
  } catch (error) {
    // A missing table (migration not yet applied) or an unreachable database
    // must not stop marking — fall through to DEFAULT_ROUTE, which is the
    // behaviour that predates this feature.
    console.error("[model-routing] Failed to load routes, using default:", error)
  }

  cache = { loadedAt: now, routes }
  return routes
}

/**
 * Resolve the model for one marking call.
 *
 * Order: the exact (activity type, criterion type) row, then the activity-wide
 * row, then the built-in default. Passing scType null asks only for the
 * activity-wide row — that is the whole-activity case, where no single
 * criterion is being assessed.
 */
export async function resolveModelRoute(
  activityType: string | null | undefined,
  scType: "binary" | "levelled" | null = null,
): Promise<ModelChoice> {
  const type = (activityType ?? "").trim().toLowerCase()
  if (!type) return DEFAULT_ROUTE

  const routes = await loadRoutes()
  if (scType) {
    const specific = routes.get(cacheKey(type, scType))
    if (specific) return specific
  }
  return routes.get(cacheKey(type, null)) ?? DEFAULT_ROUTE
}

/**
 * The key's own active activity-wide row, or null when it has none (no row,
 * or the row is inactive). Unlike resolveModelRoute, never DEFAULT_ROUTE: for
 * a caller with its own fallback, such as text answers on an assessment paper
 * falling back to the paper's route. Same 30 s cache.
 */
export async function findOwnModelRoute(key: string): Promise<ModelChoice | null> {
  const type = key.trim().toLowerCase()
  if (!type) return null
  const routes = await loadRoutes()
  return routes.get(cacheKey(type, null)) ?? null
}

/** Every configured route, newest edit first. For the admin screen. */
export async function listModelRoutes(): Promise<AiModelRoute[]> {
  const { rows } = await query(
    `select route_id, activity_type, sc_type, provider, model, effort, active, use_batch,
            updated_at::text as updated_at, updated_by
       from ai_model_routes
      order by activity_type, sc_type nulls first`,
  )
  return rows.flatMap((row) => {
    const parsed = AiModelRouteSchema.safeParse(row)
    if (!parsed.success) {
      console.error("[model-routing] Skipping unparseable route row:", parsed.error)
      return []
    }
    return [parsed.data]
  })
}
