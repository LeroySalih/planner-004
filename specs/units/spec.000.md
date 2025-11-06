# Units – Async Edit Flow

## Change Log
2025-11-05 - Updated the Lesson Panel section.

## 2025-10-03
- Converted the unit detail edit experience to the async job pattern. `UnitEditSidebar` now uses `useActionState` with `triggerUnitUpdateJobAction`/`triggerUnitDeactivateJobAction`, queues the job, and keeps the drawer open until realtime confirms completion.
- Added `unit_updates` realtime broadcasts so `/units/[unitId]` reflects updates/deactivations without a page reload. The page listens for `{ job_id, status, unit_id, unit }` payloads and reconciles optimistic state; fallback reverts if the job fails.
- Server actions now rely on the service-role Supabase client to finish work after the immediate response, logging telemetry and emitting success/error toasts on the client.
- Simplified the Add Lesson sidebar: when creating a lesson we now collect only the lesson title. Learning objectives can be linked after the lesson exists, keeping the initial flow focused and consistent with the async pattern.
- Lesson creation now uses the async job pattern. `triggerLessonCreateJobAction` queues the insert via the service-role Supabase client, broadcasts a single `lesson created` event on `lesson_updates`, and the Lessons panel swaps pending placeholders with the realtime payload, including “Pending” badges while the job is in flight.
- New lessons will start empty—no default activities or resources are pre-loaded. Teachers will populate them after the async job completes.


## Lessons Panel.
The lessons panel will list the lessons associated with the  unit in the correct order.

Each lesson row now renders a slim layout: drag handle, lesson title (clickable for editing), a pending badge when an async create job is in flight, plus the “Show activities” and “Details” buttons. The expandable detail section and inline “Edit” button have been removed.


