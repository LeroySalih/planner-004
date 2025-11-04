# Plan: Async Write Pattern for Add Lesson Flow

## Context
- The add lesson experience currently lives inside `src/components/units/lesson-sidebar.tsx`, invoked from the “Add lesson” button in `LessonsPanel`.
- New lessons are created via `createLessonAction` (and related helpers) which run synchronously, returning data only after Supabase finishes the insert + objective association.
- After the recent unit updates, our playbook requires asynchronous server actions with realtime notifications (`AGENTS.md`). We need to bring lesson creation inline with that approach.

## Tasks
1. **Audit Current Implementation**
   - Trace `createLessonAction` in `src/lib/server-actions/lessons.ts` (or equivalent) and document payloads, validation, and error handling.
   - Identify where learning objectives are linked (`createLessonLearningObjectiveAction`, etc.) so the async job can orchestrate those steps.

2. **Design Async Lesson Job Contracts**
   - Define Zod schemas for lesson job payloads (status, job id, unit id, lesson id, message, optional lesson snapshot) similar to `UnitJobPayload`.
   - Pick a realtime channel/event namespace (e.g. `lesson_updates`, `lesson:create`).

3. **Implement Job-Based Server Actions**
   - Create `triggerLessonCreateJobAction` that validates form data, returns immediately with job id, and queues a background task.
   - Background task should run the existing `createLessonAction`, attach default objectives if needed, log telemetry, and broadcast success/errors to the new channel.
   - Update server barrels (`src/lib/server-updates.ts`) to export the new action/state helpers.

4. **Refactor Lesson Sidebar Client**
   - Convert the create path to `useActionState` + optimistic UI (set local pending lesson, disable submit button, show toast).
   - Subscribe to the `lesson_updates` channel (likely in `LessonsPanel`) so the lesson list updates when the job completes and the drawer can close.
   - Ensure we handle the simplified create form (title only) and allow follow-up editing for objectives + details.

5. **Handle Learning Objective Linking Post-Create**
   - Decide whether the async job should link “default” objectives or leave them empty. If we leave them empty, document the follow-up workflow.
   - If linking is required, queue it inside the job or via a second job to keep the client contract clean.

6. **Testing & Docs**
   - Extend specs (`specs/units/spec.000.md`) describing the async lesson creation flow and realtime events.
   - Add Playwright coverage that creates a lesson, sees the optimistic placeholder, and waits for the realtime update.

## Open Questions
- (resolved) Start with a single `lesson created` broadcast; layer in additional events later as needed.
- (resolved) Leave new lessons empty—teachers will add resources and activities manually after creation.
