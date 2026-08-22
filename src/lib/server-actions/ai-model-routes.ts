'use server'

import { z } from 'zod'
import { query } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { AiEffortSchema, AiModelRouteSchema, AiProviderSchema } from '@/types'
import {
  findCatalogueEntry,
  findModelSurface,
  invalidateModelRouteCache,
  listModelRoutes,
} from '@/lib/ai/model-routing'

const RoutesResult = z.object({
  data: z.array(AiModelRouteSchema).nullable(),
  error: z.string().nullable(),
})

const NullResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

export async function readAiModelRoutesAction(): Promise<z.infer<typeof RoutesResult>> {
  try {
    await requireRole('admin')
    return RoutesResult.parse({ data: await listModelRoutes(), error: null })
  } catch (e) {
    return RoutesResult.parse({ data: null, error: String(e) })
  }
}

const UpsertInput = z.object({
  activityType: z.string().min(1),
  scType: z.enum(['binary', 'levelled']).nullable(),
  provider: AiProviderSchema,
  model: z.string().min(1),
  effort: AiEffortSchema.nullable(),
})

export async function upsertAiModelRouteAction(
  input: z.infer<typeof UpsertInput>,
): Promise<z.infer<typeof NullResult>> {
  try {
    const profile = await requireRole('admin')
    const payload = UpsertInput.parse(input)

    // Reject a model the app cannot actually call. Without this the UI would
    // happily persist a typo and marking would fail later, in the queue, where
    // it is much harder to connect to the change that caused it.
    const entry = findCatalogueEntry(payload.provider, payload.model)
    if (!entry) {
      return NullResult.parse({
        data: null,
        error: `${payload.model} is not a known ${payload.provider} model.`,
      })
    }
    // Some surfaces are narrower than their model kind implies — the chats need
    // multi-turn history, which only the Anthropic transport carries. Catching
    // it here means a misconfiguration surfaces on the admin screen rather than
    // as a failed chat turn for a teacher.
    const surface = findModelSurface(payload.activityType)
    if (surface?.providers && !surface.providers.includes(payload.provider)) {
      return NullResult.parse({
        data: null,
        error: `${surface.label} cannot run on ${payload.provider}.`,
      })
    }
    if (!entry.available) {
      return NullResult.parse({
        data: null,
        error: `${entry.label} cannot be selected yet — marking still runs through the Gemini transport.`,
      })
    }

    // Effort is an Anthropic parameter; storing one against a google row would
    // imply it does something.
    const effort = payload.provider === 'anthropic' ? payload.effort : null

    // Two statements rather than one ON CONFLICT: the uniqueness of a default
    // row is enforced by a partial index (sc_type IS NULL), which ON CONFLICT
    // cannot name as a conflict target.
    if (payload.scType === null) {
      await query(
        `UPDATE ai_model_routes
            SET provider = $2, model = $3, effort = $4, active = true,
                updated_at = now(), updated_by = $5
          WHERE activity_type = $1 AND sc_type IS NULL`,
        [payload.activityType, payload.provider, payload.model, effort, profile.userId],
      )
      await query(
        `INSERT INTO ai_model_routes (activity_type, sc_type, provider, model, effort, updated_by)
         SELECT $1, NULL, $2, $3, $4, $5
          WHERE NOT EXISTS (
            SELECT 1 FROM ai_model_routes WHERE activity_type = $1 AND sc_type IS NULL
          )`,
        [payload.activityType, payload.provider, payload.model, effort, profile.userId],
      )
    } else {
      await query(
        `INSERT INTO ai_model_routes (activity_type, sc_type, provider, model, effort, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (activity_type, sc_type) WHERE sc_type IS NOT NULL
         DO UPDATE SET provider = EXCLUDED.provider,
                       model = EXCLUDED.model,
                       effort = EXCLUDED.effort,
                       active = true,
                       updated_at = now(),
                       updated_by = EXCLUDED.updated_by`,
        [payload.activityType, payload.scType, payload.provider, payload.model, effort, profile.userId],
      )
    }

    invalidateModelRouteCache()
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

/**
 * Remove a route. The resolver then falls back to the activity-wide row, or to
 * DEFAULT_ROUTE — so deleting is how you say "treat this like everything else",
 * not how you disable marking.
 */
export async function deleteAiModelRouteAction(
  routeId: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireRole('admin')
    await query(`DELETE FROM ai_model_routes WHERE route_id = $1`, [routeId])
    invalidateModelRouteCache()
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

const KeyStatusSchema = z.object({
  provider: AiProviderSchema,
  /** Which .env variable supplies this provider's key. */
  envVar: z.string(),
  configured: z.boolean(),
  /** True when a live route points at this provider — makes a gap actionable. */
  inUse: z.boolean(),
})

const KeyStatusResult = z.object({
  data: z.array(KeyStatusSchema).nullable(),
  error: z.string().nullable(),
})

/**
 * Whether each provider's key is present — never its value.
 *
 * Keys are configured in .env (CLAUDE.md § Security); this exists so an admin
 * can see that routing a type to Anthropic will fail before pupils' work hits
 * the queue, rather than after.
 */
export async function readProviderKeyStatusAction(): Promise<z.infer<typeof KeyStatusResult>> {
  try {
    await requireRole('admin')

    const present = (name: string) => {
      const value = process.env[name]
      return typeof value === 'string' && value.trim().length > 0
    }

    const { rows } = await query<{ provider: string }>(
      `SELECT DISTINCT provider FROM ai_model_routes WHERE active`,
    )
    const inUse = new Set(rows.map((r) => r.provider))

    return KeyStatusResult.parse({
      data: [
        {
          provider: 'google',
          envVar: 'GOOGLE_API_KEY',
          configured: present('GOOGLE_API_KEY') || present('GEMINI_API_KEY'),
          // google is the fallback in DEFAULT_ROUTE, so it is always reachable
          // even with no rows pointing at it.
          inUse: true,
        },
        {
          provider: 'anthropic',
          // Report whichever name is actually set, so the screen matches the
          // .env file in front of the admin rather than a canonical name they
          // did not use. ANTHROPIC_API_KEY is preferred because the Anthropic
          // SDK picks it up with no configuration.
          envVar: present('ANTHROPIC_API_KEY')
            ? 'ANTHROPIC_API_KEY'
            : present('CLAUDE_API_KEY')
              ? 'CLAUDE_API_KEY'
              : 'ANTHROPIC_API_KEY',
          configured: present('ANTHROPIC_API_KEY') || present('CLAUDE_API_KEY'),
          inUse: inUse.has('anthropic'),
        },
      ],
      error: null,
    })
  } catch (e) {
    return KeyStatusResult.parse({ data: null, error: String(e) })
  }
}
