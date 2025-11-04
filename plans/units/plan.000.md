# Plan: Update Unit Detail Write Flows to Async Pattern

## Context Review
- `src/app/units/[unitId]/page.tsx` renders the unit detail server component and pulls data via `readUnitAction`, `readLessonsByUnitAction`, etc. No writes here.
- `src/components/units/unit-detail-view.tsx` is a client wrapper that opens sidebars for editing units, lessons, objectives, and files.
- `src/components/units/unit-edit-sidebar.tsx` currently performs direct Supabase writes by awaiting `updateUnitAction` / `deleteUnitAction` inside `startTransition`, optimistic-updating local state, and refreshing the router when finished.

This write model (awaiting the action until completion) diverges from the playbook’s preferred pattern (`AGENTS.md`) where server actions return immediately, queue long-running work, and notify the client via Supabase Realtime while the UI relies on optimistic updates and toast feedback.

## Proposed Plan (No Code Changes Yet)
1. **Audit Current Actions**
   - Inspect `src/lib/server-actions/units.ts` to confirm the current `updateUnitAction` / `deleteUnitAction` implementations and identify required telemetry/realtime gaps.
   - Document the shape of their return payloads and any downstream dependencies (`useActionState` expectations, errors, etc.).

2. **Introduce Async Server Action Variants**
   - Create new async wrappers (e.g. `triggerUpdateUnitJobAction`, `triggerDeactivateUnitJobAction`) that validate input, return immediately with a job id, and schedule the real Supabase write using the inline delay pattern (replace the prototype’s `setTimeout` placeholder with the actual Supabase mutation).
   - Ensure they call `withTelemetry`, record the auth timing, and log job lifecycle events.
   - Update the server barrel (`src/lib/server-updates.ts`) and shared types (`src/types/index.ts`) with the job payload schema.

3. **Background Worker Scheduling**
   - Reuse the `queueMicrotask` + delayed job approach from `triggerFastUiUpdateAction`, but target the actual Supabase mutations for units.
   - Broadcast `{ job_id, status, unit_id, message, payload }` envelopes so the client can reconcile optimistic state.

4. **Client-Side Refactor**
   - Convert `UnitEditSidebar` to `useActionState` with the new async action. On submit: update local optimistic unit state, push a toast indicating the queued job, and keep the sidebar interactive until realtime confirms success or failure.
- Add a shared `unit_updates` realtime subscription at the page level so the detail view, lessons list, objectives panel, and files panel all reconcile when a unit job completes. Bubble those events down via context or props so each child can refresh without a full page reload.
- Remove direct `router.refresh()` reliance; instead, update local state from realtime payloads (with a fallback refresh if events fail to arrive).

5. **Extend to Other Unit Writes**
   - Repeat the async pattern for related unit write surfaces (file uploads, lesson/objective edits) to maintain consistency. Capture the scope of each sidebar/component needing work.

6. **Testing Strategy**
   - Draft Playwright scenarios that trigger a unit edit, observe optimistic UI, and confirm the counter-toast pattern (mocking or waiting for realtime where feasible).
   - Add unit/integration tests for the new server action logic if helpers are available; otherwise document manual QA steps.

7. **Documentation Updates**
   - After implementation, append a summary to `AGENTS.md` or `specs/units/...` describing the unit write flow, channel names, and payload contracts.

## Open Questions
- (resolved) Keep the inline delay pattern—swap in the real Supabase write instead of the simulated `setTimeout`.
- (resolved) Subscribe at the page level to `unit_updates` so all child widgets stay in sync without a reload.
- No additional downstream cache invalidation planned right now; reassess if future features require it.
