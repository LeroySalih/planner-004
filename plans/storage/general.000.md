# Plan: Replace Supabase Storage with Local FS + Postgres Metadata

## Goal
Move file storage off Supabase buckets to a local `./files` directory with Postgres-backed metadata, protected upload/download APIs, and a migration script to pull existing bucket contents into the new store.

## Step Breakdown
1. **Design FS + Schema**
   - Define a file layout under `./files` mirroring current Supabase bucket paths; keep the same structure but replace any pupil user-id GUID segments with the pupil email.
   - Add a metadata table capturing ownership, size, content type, checksum, and access controls; enforce application-level authorization (teachers and pupils can access files; enforce rules in app logic).

2. **Add DB Structures**
   - Create/alter migrations for a `files` (or `stored_files`) table and any linkage tables needed for lessons/units/activities/assignments.
   - Index by owner/foreign keys and checksum for dedupe; enforce non-null constraints where needed.

3. **Implement Storage Service**
   - Add a server-side storage module that writes/reads/deletes files on disk, records metadata in Postgres, validates checksums/size, and handles versioning by renaming any existing file with the same name to `<file>_<dd-mm-yyyy_HH-mm-ss>` before saving the new one (new upload keeps the original name).
   - Ensure paths are sanitised and all operations are wrapped with telemetry + error handling.

4. **HTTP API (Upload/Download)**
   - Expose authenticated routes for upload, download, and metadata retrieval; reuse existing auth guards (teacher/pupil) and validate per-entity permissions.
   - Stream uploads to disk, persist metadata (size, uploader, timestamps, checksum), and stream downloads with correct headers; serve the latest version by default, with an option to request a prior version by file name.
   - Include SSE broadcast hooks if file changes need realtime updates.

5. **Migrate Existing Bucket Objects**
   - Write a script to enumerate relevant Supabase buckets (lessons, units, activities, submissions, etc.), download objects, store them under `./files` preserving the current structure (with pupil IDs rewritten to emails), and insert corresponding metadata rows (including original upload timestamps as version metadata).
   - Log any mismatches or failures for manual follow-up; make the script idempotent where possible and track original Supabase object paths for traceability.

6. **Swap Integrations**
   - Replace current Supabase storage calls in lesson/unit/activity upload flows with the new storage service.
   - Update queue/download handlers to use the new API and metadata lookups; remove Supabase storage dependencies once parity is confirmed.

7. **Verification**
   - Smoke-test uploads/downloads across lessons, units, activities, and assignment result flows (including SSE notifications where applicable); enforce a 5MB max file size in upload handling.
   - Run `npm run build` and any relevant e2e/manual checks; document rollout and backfill steps in `AGENTS.md`.
