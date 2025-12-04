# SSE Migration Plan

## Goals
- Replace Supabase Realtime dependencies with a native Server-Sent Events layer that fans out updates per table/domain.
- Keep auth, telemetry, and existing server action patterns intact; avoid leaking Supabase keys to clients.
- Provide a clear contract for event shapes so pages can subscribe without tight coupling to tables.

## Decisions (working)
- Initial domains: assignments, submissions, feedback, file uploads.
- Visibility: events are available to all teachers; pupils do not receive streams.

## Decisions (storage)
- Persist events for late joiners in Postgres (event log table); plan replay or catch-up strategy per topic.

## Decisions (limits)
- No rate limits/backpressure needed initially; keep emit/subscribe open for teachers (pupils not subscribed).

## Phased Approach
1) **Scaffold SSE core**
   - Promote the current in-memory hub to a reusable module: global singleton, typed channels per domain, heartbeat/ping, drop handling.
   - Define event envelopes (e.g., `{ type, domain, table, recordId, payload, emittedAt }`) and add Zod schemas.
   - Add shared client helper (wrapper around `EventSource`) with reconnection/backoff and typed handlers.
2) **Server plumbing**
   - Create a streaming route per domain or a multiplexed `/sse` with query params (e.g., `?topic=assignments`), guarded by auth where needed.
   - Ensure `withTelemetry` wraps stream creation and emitters; log connection counts and errors.
   - Add an emit helper usable from server actions and webhooks.
3) **Database hooks**
   - For each target table, decide the trigger point:
     - Inside existing server actions (preferred): emit after successful write.
     - Webhooks/Supabase functions if writes happen outside Next.js (fallback).
   - Map table events to topics/types (e.g., `assignment:updated`, `lesson:score:updated`), include minimal payload (ids + derived summaries).
4) **Client consumption**
   - Swap Supabase Realtime usages with the EventSource helper:
     - Assignment Manager, pupil lessons, prototypes relying on broadcast.
     - Ensure UI uses `useEffect` + local reducers; keep optimistic paths intact.
   - Add connection status UI (badge/toast) and graceful retry messaging.
5) **Resilience & ops**
   - Add heartbeat/ping to keep proxies happy; close dead connections.
   - Document limits: single-instance in-memory vs. multi-instance deployment (consider shared store if scaling out).
   - Add lightweight monitoring: log connection counts, emit failures, and average latency.

## Risks / Mitigations
- **Multi-instance drift**: In-memory hub won’t sync across processes; plan for Redis/Postgres NOTIFY or a durable broker if horizontal scaling is needed.
- **Auth leakage**: Streams must enforce the same auth/role checks as server actions; avoid exposing raw table rows.
- **Payload bloat**: Keep payloads small (ids + summaries); rely on existing loaders for full hydration.
- **Reconnect storms**: Implement jittered backoff and rate limits on emits.
- **Schema drift**: `profiles.user_id` is text; SSE `emitted_by` uses `text` FK to match (migration adjusted).

## Next Steps
- Finalize domain event contracts (assignments, submissions, feedback, uploads) and payload shapes.
- Add shared EventSource client helper with reconnection/backoff and topic filtering for production pages.
- Wire domain server actions/webhooks to emit via the SSE hub (start with assignments/submissions) and update UIs to consume `/sse`.
- Plan Supabase Realtime removal once feature parity is validated on the pilot.

## Implementation Snapshot (current)
- Added Postgres event log table `sse_events` with indexes for replay.
- Implemented Node SSE hub (global singleton) with topic-aware fan-out, ping keep-alive, and persistence.
- Exposed teacher-only SSE stream at `/sse?topics=...` plus test topic wiring for `/test-sse` demos.
- Test clients now consume the shared SSE route; events are stored for catch-up on connect.
