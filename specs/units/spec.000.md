# Units – Async Edit Flow

## 2025-10-03
- Converted the unit detail edit experience to the async job pattern. `UnitEditSidebar` now uses `useActionState` with `triggerUnitUpdateJobAction`/`triggerUnitDeactivateJobAction`, queues the job, and keeps the drawer open until realtime confirms completion.
- Added `unit_updates` realtime broadcasts so `/units/[unitId]` reflects updates/deactivations without a page reload. The page listens for `{ job_id, status, unit_id, unit }` payloads and reconciles optimistic state; fallback reverts if the job fails.
- Server actions now rely on the service-role Supabase client to finish work after the immediate response, logging telemetry and emitting success/error toasts on the client.
- Simplified the Add Lesson sidebar: when creating a lesson we now collect only the lesson title. Learning objectives can be linked after the lesson exists, keeping the initial flow focused and consistent with the async pattern.
- Lesson creation now uses the async job pattern. `triggerLessonCreateJobAction` queues the insert via the service-role Supabase client, broadcasts a single `lesson created` event on `lesson_updates`, and the Lessons panel swaps pending placeholders with the realtime payload, including “Pending” badges while the job is in flight.
- New lessons will start empty—no default activities or resources are pre-loaded. Teachers will populate them after the async job completes.
