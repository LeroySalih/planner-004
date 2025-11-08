# Lesson Detail Fire-and-Forget Write Flows Plan

## Objectives
- Convert every write operation reachable from `/lessons/[lessonId]` into a “server-side fire-and-forget” pattern that queues mutations, runs them asynchronously, and publishes status/results via Supabase Realtime.
- Ensure the UI relies on optimistic updates + realtime events instead of awaiting action responses, keeping buttons interactive and aligned with the `useActionState` pattern.
- Maintain telemetry coverage and logging parity with the new async flows.

## Targeted Write Flows
1. **Success Criteria Linking** – `setLessonSuccessCriteriaAction` plus LO/SC creation helpers invoked from `LessonObjectivesSidebar`.
2. **Lesson Metadata Updates** – `updateLessonAction` (title/objective linking) and related reorder/deactivation flows.
3. **Lesson Activities** – Create/update/delete/reorder, homework/summative toggles, SC tagging inside `LessonActivitiesManager`.
4. **Lesson Links** – CRUD operations from `LessonLinksManager`.
5. **Lesson Files** – Upload/delete via `LessonFilesManager` (storage + metadata refresh).
6. **Activity Files/Submissions** – Upload/delete media for activities and pupil submissions referenced from the lesson detail.
7. **Lesson Success Criteria Actions** – Standalone link/unlink APIs used outside the sidebar but affecting the same lesson view.

## Implementation Steps
1. **Design Realtime Contracts**
   - Define channel events (e.g., `lesson:mutated`, `lesson:filesUpdated`, `lesson:activitiesUpdated`) with payload schemas describing the mutation, job ID, and resulting lesson snapshot.
   - Extend `LessonJobPayloadSchema` or add new schemas to cover each mutation type, ensuring clients can differentiate events.

2. **Queue + Worker Infrastructure**
   - For each server action, replace direct Supabase updates with:
     1. Validation + telemetry + job ID creation.
     2. Immediate `queued` response to the client (via `useActionState`), including job metadata.
     3. `queueMicrotask`/background worker (or serverless queue) that performs the actual Supabase writes, wraps them with telemetry, and then publishes a realtime event.
   - Reuse the existing service client (`createSupabaseServiceClient`) where elevated access is required.

3. **Realtime Publishing**
   - Emit events on a shared lesson channel (e.g., `lesson_updates`) with typed payloads per mutation type.
   - Include enough context for clients to reconcile (lesson ID, affected entities, optional refreshed lesson snapshot).

4. **Client Subscription Updates**
   - Within `/lessons/[lessonId]` client components, subscribe to the lesson channel:
     - Update local state when payloads arrive (e.g., merge updated success criteria, activities, files).
     - Remove reliance on server action return values; instead, trigger optimistic updates and wait for realtime confirmation.
   - Ensure components surface job states (queued/in-progress/completed/error) based on realtime messages.

5. **Error Handling & Telemetry**
   - Standardize job payloads to include `status`, `message`, and optional error details.
   - Telemetry should log enqueue/dequeue timing plus mutation execution duration to `logs/telem_<timestamp>.log`.

6. **Documentation & Spec Updates**
   - Update `specs/lessons/spec.000.md` to document the queued write flow, expected realtime events, and optimistic UI requirements.
   - Record channel names, payload shapes, and client responsibilities.

## Open Questions
## Open Questions
- None at this time.
