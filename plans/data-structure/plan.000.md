# Plan: Add `spec_ref` to Learning Objectives

## Context
- Learning objectives currently lack a reference to specification items.
- New text field `spec_ref` should be optional/defaultable so existing rows remain valid.

## Proposed Steps
1. **Database Migration**
   - Generate a Supabase migration adding a nullable `spec_ref text` column to the `learning_objectives` table (set default `null` or empty string per conventions).
   - Update any database views or triggers referencing the table if required.
   - Apply the migration locally and confirm the column appears.
2. **Type Definitions**
   - Extend the relevant Zod schema(s) in `src/types/index.ts` to include the optional `spec_ref` property.
   - Regenerate inferred TypeScript types and ensure server/client code consuming the schema compiles.
3. **Server Actions & Data Fetching**
   - Audit server actions or loaders dealing with learning objectives (e.g. in `src/lib/server-actions` or `src/actions`) and include `spec_ref` in selects, inserts, and updates.
   - Ensure telemetry logging embraces the new field where payloads are recorded.
4. **UI & Forms**
   - Identify UI surfaces that display or edit learning objectives (likely under `src/components` and `src/app` routes).
   - Add inputs or read-only displays for `spec_ref`, wiring through `useActionState` where users can set the field.
   - Use existing form primitives and validation messaging for consistency.
5. **Seed & Fixtures**
   - Update Supabase seeds (`supabase/seed.sql`, `supabase/seed-users.mjs` if applicable) and any Playwright fixtures ensuring examples include `spec_ref`.
6. **Testing & Verification**
   - Adjust Playwright or integration tests that create/verify objectives to cover the new field.
   - Smoke test server actions and UI form submissions locally; capture telemetry logs with `TELEM_ENABLED=true` to verify behavior.
