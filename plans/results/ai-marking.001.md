# Plan: Pupil-Led AI Marking Submission

## Goal
Enable pupils to submit completed short-text activities from the pupil-lessons page to the AI marking workflow (`short-text-submission` at `AI_MARK_WEBHOOK_STS_URL`) for automated scoring and feedback.

## Steps
1) **Map current flow**
   - Trace pupil-lessons data sources and UI components to find where completed activities and short-text answers are available.
   - Identify existing AI marking hooks or helpers (webhooks, server actions, telemetry wrappers) to align with.

2) **Server action for submissions**
   - Create a server action that gathers the pupil’s completed short-text activities for a lesson/assignment and builds payload `{ pupilId, assignmentId, activities[] }`.
   - POST to `AI_MARK_WEBHOOK_STS_URL` with workflow `short-text-submission`; include telemetry and error handling consistent with server actions.
   - Export via the server-updates barrel; validate inputs with Zod and reuse auth guards (pupil context) to avoid leaking supabase clients to the browser.

3) **UI hook-up in pupil-lessons**
   - Add a "Submit for AI marking" button in the pupil-lessons page, visible after activities are completed and when short-text answers exist.
   - Wire to the new server action using `useActionState`, show in-flight feedback, and surface success/failure via `sonner` toasts; keep button reusable for retry.

4) **Checks and docs/tests**
   - Update or add notes/tests (Playwright stub) covering the new entry point for submissions and confirm payload alignment with `AI_MARK_WEBHOOK_STS_URL` requirements.
   - Note any telemetry/log file expectations if new toggles are added.

## Notes & Risks
- Ensure only short-text activities are sent; other types must be excluded.
- Respect existing Zod schemas for activity/pupil data; add/extend schemas first if needed.
- Follow shared server action patterns (auth guard reuse, telemetry, error envelopes) to avoid duplicating supabase client usage on the client.
