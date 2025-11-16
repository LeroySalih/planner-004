# Results: Feedback Write + Reports Cache Prototype

# Change Log
2025-11-09 17:25 Updated the Editing section with changes to the side bar.
2025-11-12 09:10 Added the AI Marking section describing automated scoring UX, data flows, and telemetry expectations.
2025-11-13 14:20 Clarified cell background states (white vs. gray vs. RAG) for the assignment results grid.
2025-11-13 16:45 Added realtime update requirements for pupil submissions and AI webhook feedback.
2025-11-13 17:45 Documented Supabase Realtime prerequisites (submissions PK + replica identity) for assignment updates.

# Description
The results/assignments page allows the teacher to view and override the feedback for a pupil on the acitvities of a lesson.

## Editing

- Activity cells surface state through their background color: untouched activities render with a white background, submissions awaiting marking (value entered or file uploaded) switch to gray, and once a teacher override or automatic score is accepted they resume the standard red/amber/green palette. Any new pupil submission after marking flips the background to gray again so teachers can spot items that need review.

- To view or overide a score, the teacher will click on a cell, which will open the feedback side bar.

- The feedback sidebar has the activity title, the activity status, the mark (percent) and whether the mark is auto or overridden.

- The side bar will then display 3 tabs, Question, Automatic Score and Override.

   - Question: this will display the question and pupil answers.  If the activity is an upload file, their will be a cached download link (signed URL) that can be reused until the file changes, plus a refresh button so teachers can request a new signed URL when needed.

   - Automatic Score:  This will display the automatic score assigned to the question, even when an override is active, so teachers can compare the stored automatic values.
     - Automatic feedback mirrors the same red/amber/green styling palette used for override feedback so teachers can compare machine vs. human scoring at a glance.

- Override: This will display all ofthe Success Criteria that are associated with the acitvity, and allow the teacher to enter 0, Partial (50%) or Full via button, or a specific value by text box.  The teacher can also add text feedback.
   - Override reasons remain free-form text; no structured status field is required beyond the override marker.


- Automatic Score tab now also renders any AI-generated feedback (distinct from the teacher override text) so staff can compare machine commentary with their own notes.

- Each column header sidebar exposes two CTA buttons (both wrapped in `useTransition`):
  1. `AI Mark` – triggers `requestAiMarkAction`, posting `{ requestid, question_text, model_answer, provided_answers, group_assignment_id, activity_id }` to `AI_MARK_URL` with headers `mark-service-key` and `mark-webhook-url`.
  2. `Clear AI Marks` – calls `clearActivityAiMarksAction`, which sets `ai_model_score`/`ai_model_feedback` to null for that activity, recomputes success-criteria averages, revalidates `/results/assignments/[group__lesson]`, and refreshes the client grid.
  - Buttons show “Sending…” / “Clearing…” states, remain retryable, and toast success/failure via `sonner`.

- Clearing AI marks immediately resets the affected column’s auto scores/feedback locally while a router refresh keeps Supabase data in sync.


## Data Flows
1. Preserve the current UX already proven in unit/lesson editing flows:
   - Server action returns immediately after the basic Supabase write.
   - Client performs optimistic updates and keeps buttons interactive.
   - Browser members subscribe via Supabase Realtime to reconcile the eventual authoritative state.
2. Extend the feedback write flow so that, after the immediate response, the server fire-and-forget queues async transactional work that recalculates and stores cached report data for the affected pupil only.
3. Introduce derived calculation tables dedicated to powering `/reports`, aggregated per student so `/reports/{pupilId}` can render directly from precomputed unit summaries (`report_pupil_unit_summaries`) while `/reports/groups/{groupId}` derives cohort views from those rows. Provide a migration-time backfill that seeds these tables from existing feedback scores so the prototype works immediately on current data.
4. Write the async calculations as explicit transactional procedures/operators inside the database layer (no triggers) so success/failure stays observable. All access from Next.js must go through the Supabase API/SDK.
5. Ensure telemetry hooks wrap the new server pathway to capture function names, params, and timing deltas, gated by `TELEM_ENABLED` and `TELEM_PATH`.
6. Document the workflow inside this specs file and cross-reference in future planner updates.
7. `readAssignmentResultsAction` is the canonical source for sidebar data; it now sanitizes question text, captures upload instructions, records auto vs. override metadata, and wraps its Supabase calls with `withTelemetry` so `/results/assignments` logging stays consistent.

## Realtime Updates
- `/results/assignments/[group__lesson]` subscribes to Supabase Realtime channels scoped to the active assignment so cells update as soon as pupils submit text answers or upload files from the pupil lesson page. Event payloads should at minimum include `{ submissionId, pupilId, activityId, status, submittedAt }` so the grid can patch the affected cell without a full revalidation.
- AI feedback arriving via `/api/mcp` webhook callbacks must dispatch events on the same channel immediately after Supabase persists new auto scores/feedback. Automatic Score panes re-render in place while the rest of the matrix stays interactive.
- Realtime handlers remain idempotent—if the payload is incomplete, trigger a targeted `readAssignmentResultsAction` fetch for that row/activity while keeping the optimistic state visible.
- Gate the subscription behind a feature flag so environments without Supabase Realtime fall back to manual refresh without error spam.
- Infra prerequisite: the `public.submissions` table must expose a primary key (`replication_pk` UUID identity) and `REPLICA IDENTITY FULL` so Supabase Realtime emits full row payloads. Migrations `2025120115000000_submissions_replica_identity.sql` and `2025120115000001_submissions_primary_key.sql` enforce this locally; remote environments must apply equivalent DDL before enabling the channel.

## AI Marking
- **Purpose**: Allow teachers to invoke AI-assisted scoring for selected activities/pupils so baseline marks are generated quickly before human overrides.
- **Entry points**:
  - Per-cell “Run AI marking” button inside the Automatic Score tab.
  - Bulk action from the results grid toolbar to queue AI scoring for multiple pupils/activities simultaneously.
  - Both entry points must be wrapped in `useActionState`; buttons surface “Queued…/Processing…” states, stay clickable for retries, and always toast success/failure via `sonner`.
- **UX states**:
  - `Idle`: button enabled, shows “Run AI marking”.
  - `Queued`: immediate optimistic state once server action returns; button label switches to “Queued…” and a dotted spinner displays inline.
  - `Processing`: fed by Supabase Realtime updates from the job queue; cell shows a “AI calculating…” badge.
  - `Completed`: automatic score + per-criterion auto scores populate, plus timestamp of when AI finished.
  - `Failed`: cell badges the failure; retry CTA appears and the toast includes the error string.
- **Data flow**:
  1. Client calls `queueAssignmentAiMarkingAction` (new server action) with `{ assignmentId, activityId, pupilIds[], strategy }`.
  2. Action validates input with Zod, enforces `requireTeacherProfile()`, and wraps work with `withTelemetry({ routeTag: "/results/assignments:ai" })`.
  3. Server writes a job row (e.g., `assignment_ai_jobs`) and enqueues work to Supabase functions or an Edge Function that calls the AI provider.
  4. AI worker reads submissions (or raw answers), calls the provider, normalises scores per success-criterion, and writes back to `submissions` using the same schemas (`ShortTextSubmissionBodySchema`, etc.).
 5. On completion, worker emits Supabase Realtime events on the assignment channel so the Assignment Results dashboard can reconcile without a full refresh (and `/reports` mirrors, if open) and then triggers the existing report-cache recalculation queue once per pupil.
- **Guardrails & observability**:
  - Telemetry: Log function name, params (minus PII), total duration, AI call duration, and queue latency when `TELEM_ENABLED=true`. Respect `TELEM_PATH` by tagging events with `/results`.
  - Authorization: Ensure only teachers with access to the assignment can queue AI; reuse `requireTeacherProfile()` plus a future `requireGroupMembershipForTeacher()` helper.
  - Auditing: Persist AI metadata (model, prompt hash, completion ID) inside a JSONB column on `submissions` for traceability.
  - Error handling: return `{ error: "Readable message" }` envelopes to the client, log stack traces server-side, and never fail silently; fallback message “AI marking is unavailable right now—please retry or mark manually.”
- **Testing expectations**:
  - Unit coverage once utilities exist (e.g., normalising AI responses, job queue helpers).
  - Playwright flows: queue AI from a single cell and verify UI transitions; simulate failure (mocked API) and ensure retry path works; confirm final automatic score renders.
  - Manual QA checklist: verify telemetry log entries when `TELEM_ENABLED=true`, confirm Supabase job rows clean up, ensure report-cache recalcs run once per AI batch.
  - Provide instructions for stubbing AI providers in local/test environments (e.g., env flag `AI_MARKING_USE_FAKE=true`).
