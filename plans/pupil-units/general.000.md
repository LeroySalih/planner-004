# Plan: Pupil Units overview

## Goal
Deliver the pupil-facing `/pupil-lessons/[pupilId]` units view described in `specs/pupil-units/general.000.md`: group units by subject, order by the first assigned lesson date, and list active lessons with title, LO, thumbnail images/files, and a link into `/pupil-lessons/[pupilId]/lessons/[lessonId]`.

## Steps
1) Confirm the data contract  
   - Map the current pupil-lessons payloads (summary/detail RPCs, Zod schemas in `src/types`) to see whether units, earliest lesson dates, active lessons, display image activities, and attached files are already returned.  
   - Decide whether to extend `pupil_lessons_summary_bootstrap` or add a dedicated units-focused RPC; define the expected shape before touching UI.
2) Extend Postgres RPC + schemas (no Supabase client)  
   - Update the chosen RPC to return units the pupil has through group membership, include the earliest assigned lesson date per unit for ordering (break ties alphabetically by unit name), and filter to active (published) lessons only (include lessons even when no media exists).  
   - Ensure lesson entries surface LO (only), display image assets (storage paths/URLs), linked files (all file types, include mime/ext for thumbnail rendering), and preserve the unit-defined lesson ordering. Mirror these fields in `src/types/index.ts` and inferred TS types.
3) Server actions and shaping (pg client only)  
   - Add/adjust server actions under `src/lib/server-actions` (and barrel `server-updates`) to call the RPC via the pg client, wrap with `withTelemetry` using existing TELEM_PATH conventions, and guard once via `requireAuthenticatedProfile()`.  
   - Normalize the payload on the server into `subject -> units -> lessons` with correct ordering and asset URLs ready for rendering; keep the browser free of Supabase or direct pg usage.
4) UI implementation  
   - Build the server-side page/component under `src/app/pupil-lessons/[pupilId]` that renders subject sections with their units, showing an empty state when a subject has no units.  
   - For each unit, list active lessons in the unit-defined order showing title, LO, display image thumbnails (click to full-screen modal) and linked files, and show lessons gracefully when no media is present; wire lesson titles to the detail route only when the pupil is enrolled (render as text otherwise). Unit heading suffices; no lesson count badges—keep UI minimal.  
   - Use server components where possible; keep client components minimal (e.g., only for modals/interactions).  
   - Use a full scroll list (no pagination/virtualization) with sensible spacing for long lists and a simple loading indicator (no shimmer).
5) Media handling polish  
   - Reuse existing image/file UI primitives; ensure thumbnails are sized consistently, support single-image fullscreen viewing (no gallery navigation), and include accessible alt text.  
   - Show thumbnails for all linked files (use file-type fallback for non-images) and trigger direct downloads on click. Handle missing or unsupported assets gracefully (fallback states).
6) Verification  
   - Smoke-test with seeded pupil data to confirm grouping/order, active-lesson filtering, media rendering, and navigation to lesson detail.  
   - Validate telemetry log output and ensure no client-side Supabase usage or extra guard calls.
