-- 089-route-marking-to-claude.sql
--
-- Move AI marking from Gemini to Claude.
--
-- The immediate reason is availability: generativelanguage.googleapis.com is
-- geo-blocked from Saudi Arabia, where this app is hosted, so every marking
-- call was failing in production. The choice of model is separately evidenced —
-- replaying eight stored marking jobs through Haiku 4.5, Sonnet 5 and Opus 5
-- and comparing against the Gemini result they already had:
--
--   * All four models agreed exactly on six of the eight.
--   * Haiku 4.5 awarded full marks for a wrong answer on one of the other two,
--     so its high agreement score is misleading.
--   * Opus 5 over-credited on the remaining one, inferring a method the pupil
--     had not shown — which BASE_SYSTEM explicitly forbids.
--   * Sonnet 5 made neither error and was within one mark on all eight.
--
-- Sonnet 5 also carries the same high-resolution vision tier as Opus (2576px
-- long edge) at 60% of the cost, which is what the worksheet types need.
--
-- These are defaults, not a lock-in: /admin/ai-models edits any of them, and
-- per-criterion overrides (binary vs levelled) can still point elsewhere.
--
-- Requires 088-ai-model-routes.sql.

BEGIN;

UPDATE public.ai_model_routes
   SET provider   = 'anthropic',
       model      = 'claude-sonnet-5',
       updated_at = now(),
       updated_by = 'migration-089'
 WHERE sc_type IS NULL
   AND provider = 'google'
   AND activity_type IN (
     'short-text-question',
     'upload-code',
     'upload-worksheet',
     'mark-worksheet',
     'upload-spreadsheet'
   );

COMMIT;
