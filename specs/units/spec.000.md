# Units – Async Edit Flow

## 2025-10-03
- Converted the unit detail edit experience to the async job pattern. `UnitEditSidebar` now uses `useActionState` with `triggerUnitUpdateJobAction`/`triggerUnitDeactivateJobAction`, queues the job, and keeps the drawer open until realtime confirms completion.
- Added `unit_updates` realtime broadcasts so `/units/[unitId]` reflects updates/deactivations without a page reload. The page listens for `{ job_id, status, unit_id, unit }` payloads and reconciles optimistic state; fallback reverts if the job fails.
- Server actions now rely on the service-role Supabase client to finish work after the immediate response, logging telemetry and emitting success/error toasts on the client.
