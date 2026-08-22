-- 090-model-surface-routes.sql
--
-- Bring the last hardcoded model choices under configuration.
--
-- Migration 088 made *marking* configurable per activity type, but six model
-- ids were still compiled in: both AI chats, two OCR paths, the sketch
-- guardrail, and image generation. Any of those needing to move provider — as
-- all of them did when Gemini was geo-blocked — meant a code change and a
-- deploy.
--
-- These reuse ai_model_routes rather than introducing a second mechanism:
-- `activity_type` holds a "surface:" key, which cannot collide with a real
-- activity type. Resolution, caching and the admin screen are all unchanged.
--
-- Requires 089-route-marking-to-claude.sql.

BEGIN;

INSERT INTO public.ai_model_routes (activity_type, sc_type, provider, model, updated_by)
VALUES
  -- Text surfaces follow marking onto Claude: same reason (Gemini is
  -- geo-blocked from Saudi Arabia) and the chats are already running on it.
  ('surface:lesson-chat',      NULL, 'anthropic', 'claude-sonnet-5', 'migration-090'),
  ('surface:unit-chat',        NULL, 'anthropic', 'claude-sonnet-5', 'migration-090'),
  ('surface:worksheet-ocr',    NULL, 'anthropic', 'claude-sonnet-5', 'migration-090'),
  ('surface:handwriting-ocr',  NULL, 'anthropic', 'claude-sonnet-5', 'migration-090'),
  ('surface:sketch-guardrail', NULL, 'anthropic', 'claude-sonnet-5', 'migration-090'),
  -- Image generation stays on Google: no Anthropic model generates images.
  -- Mothballed in code (IMAGE_GENERATION_ENABLED), but the route is seeded so
  -- reviving it is a config change rather than a code change.
  ('surface:image-generation', NULL, 'google', 'gemini-3-pro-image-preview', 'migration-090')
ON CONFLICT DO NOTHING;

COMMIT;
