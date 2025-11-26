# File Upload Queue (/queue)

## ChangeLog
2025-11-24 - Initial spec for queue management of file upload activities with status lifecycle and teacher download workflow.

## Purpose
Define the status model and teacher-facing queue UI for managing pupil file upload activities, while keeping uploads defaulted to `inprogress` and ensuring all database work uses the Postgres `pg` client.

## Status Model
- Status stored as a text column with a check constraint enforcing values: `inprogress` (default), `submitted`, `completed`, `rejected`.
- Any upload event (including replacements) sets the submission row to `inprogress` before processing the file.
- Pupils can change status from `inprogress` to `submitted` via a drop-down on the activity card.
- Teachers can change status to any state via the queue screen; transitions should be fire-and-forget server actions with optimistic UI and telemetry logging.

## Pupil Experience (activity card)
- The file upload activity retains existing upload UX; after upload the status drop-down remains visible.
- Status selector defaults to `inprogress` after any upload, regardless of prior state.
- When a pupil picks `submitted`, trigger a server action to persist the status (pg client only), show loader/toast using `useActionState`, and keep the UI responsive.
- Replacements do not auto-advance status; the pupil must explicitly choose `submitted` each time they are ready.

## Teacher Queue Page (/queue)
- Server-rendered page with dropdown filters for Group, Unit, Lesson, and Activity to pick the target activity.
- Data loads server-side via pg queries only (no Supabase client) and is scoped to the selected curriculum context.
- Once an activity is selected, list all files for the chosen group–lesson–activity with pupil name, uploaded timestamp, file size, and current status.
- Provide a button to download all listed files as a zip (server bundles files and returns a streaming response).
- Each row includes a status drop-down limited to `completed` or `rejected`, with fire-and-forget updates and optimistic feedback (toast + pending indicator). Changing status does not block other UI interactions.
- Telemetry (`withTelemetry`) wraps queue reads and writes when `TELEM_ENABLED=true`, logging to `logs/telem_<timestamp>.log`.

## Data & Storage Considerations
- All DB reads/writes for statuses and queue listings use the pg client configured with `DATABASE_URL` fallback envs; no Supabase client usage.
- Status should be stored alongside the file submission record; ensure migrations cover new enum/column as needed.
- File download bundling should stream from storage paths already persisted for uploads; reuse existing file metadata to avoid new bucket calls per row.

## Edge Cases
- If a pupil has no file yet, the row shows a placeholder and status remains `inprogress`.
- If a file is deleted or missing, surface a warning badge in the list and skip it in the zip while still completing the request.
- Teacher status updates should tolerate concurrent changes; show last saved state after server confirmation.
