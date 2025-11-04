# Prototype: Fast I/O Async Updates

## Goal
Implement the `/prototypes/fast-ui` flow described in `specs/protoypes/fast-ui.000.md`, allowing optimistic UI updates while the server finishes slower work and notifies the client via Supabase Realtime.

## Plan
1. **Confirm Contracts**
   - Re-read existing telemetry/environment expectations from the playbook.
   - Identify or add any Zod schema updates needed in `src/types/index.ts` for the prototype payload.
2. **Server Action & Telemetry**
   - Create a server action under `src/lib/server-actions/prototypes/fast-ui.ts` that:
     - Guards access with `requireTeacherProfile()` (or appropriate auth helper).
     - Logs telemetry if `TELEM_ENABLED` and `TELEM_PATH` match `/prototypes/fast-ui`.
     - Returns immediately to the caller with an optimistic response envelope.
     - Schedules the simulated heavy work (10 s delay) and emits a Realtime notification when done.
3. **Realtime Messaging**
   - Define a dedicated channel name/payload contract (e.g., `fast_ui_updates`) and ensure the Supabase server client publishes messages after the delay.
   - On the client, subscribe via the Supabase browser client wrapper to listen for job completion events.
4. **Page & UI**
   - Add the `/prototypes/fast-ui/page.tsx` route.
   - Render counter label, status label, and action button using shared UI primitives.
   - Use `useActionState` (or `useTransition`) to show in-progress feedback per button press while keeping the button enabled unless domain constraints require throttling.
5. **Client State Handling**
   - Keep a local counter that increments optimistically on each click.
   - Update status text when Realtime notifications arrive, handling multiple concurrent jobs safely.
   - Ensure Supabase clients are only used through approved wrappers; no direct client instantiation.
6. **Testing & Docs**
   - Add a Playwright spec under `tests/prototypes/fast-ui.spec.ts` to cover optimistic increment and delayed status update (mocking Realtime if necessary).
   - Document the new workflow in `specs` or playbook if persistent.
   - Verify logs are written to `logs/telem_*.log` when telemetry is enabled.
7. **Final Review**
   - Run targeted build/check commands if applicable.
   - Review for adherence to Tailwind class conventions and Radix primitives.
   - Ensure no Supabase secrets leak to the client, and queuing/notification logic is guarded.

## Open Questions
- Do we need to throttle or queue duplicate requests from a single user?
- Should the Realtime channel be multi-tenant (per user session) or shared across all prototype viewers?
- How should errors from the delayed task surface in the UI (toast vs. inline)?
