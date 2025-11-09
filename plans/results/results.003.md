# Plan: Results AI Marking Section

## Goals
- Add an explicit **AI Marking** section to `specs/results/general.000.md` so future work on automated scoring is grounded in shared expectations.
- Ensure the spec change is actionable: it should describe UX, data flows, and guardrails (auth, telemetry, Supabase RPC patterns) in the same format as the existing Editing/Data Flow guidance.
- Keep the actual product experience consistent with the planner playbook (server actions, optimistic UI, telemetry, Supabase RPCs).

## Current Understanding
- The spec currently covers Editing and Data Flows only; AI-assisted scoring is implied by existing score automation but not documented.
- `readAssignmentResultsAction` already returns auto vs. override metadata, and front-end tabs display “Automatic score.” The AI flow likely feeds that auto score via existing AI-backed submissions (`ShortTextSubmissionBodySchema`, etc.).
- Any AI Marking section should clarify how teachers trigger AI, how long-running AI jobs are handled, and what data is stored/audited.

## Implementation Steps
1. **Define AI UX & States**
   - Document the teacher entry points (per-row action? bulk action?), required inputs (question type, selected pupils), and visible states (idle, queued, running, completed, failed).
   - Capture optimistic UX expectations: use `useActionState` for AI-trigger buttons, show toasts, and keep buttons retryable.

2. **Backend & Data Flow Notes**
   - Describe how the AI request flows: server action → Supabase RPC or Edge Function → AI provider → Supabase writes.
   - Reference existing guard rails: `requireTeacherProfile()`, `withTelemetry`, Supabase RPC naming, queueing long-running jobs, storing `{ data, error }` envelopes.
   - Clarify storage expectations (where AI feedback lives, schema updates if needed, telemetry/logging requirements, audit trails).

3. **Performance & Observability**
   - Specify that AI marking jobs must log telemetry (function name, params, timings), surface progress via Supabase Realtime, and fall back gracefully when TELEM flags are off.
   - Outline how to reuse the report-cache queue so recalcs happen once per AI batch instead of per-cell.

4. **Spec Authoring Tasks**
   - Add a new `## AI Marking` section under `specs/results/general.000.md` with: purpose statement, UX bullets, data flow bullets, error/edge-case handling, and testing expectations.
   - Update the Change Log with the date/time plus summary of the AI section addition.

5. **Testing & QA Notes**
   - In the spec, note the need for Playwright coverage once AI UI ships (e.g., verifying state transitions) and mention how to stub AI responses for deterministic tests.
   - Mention any manual QA checklist (e.g., verify telemetry logs when `TELEM_ENABLED=true`, ensure fallback messaging when AI is disabled).

## Deliverables
- Updated `specs/results/general.000.md` containing the AI Marking section structured similarly to existing sections.
- Optional follow-up tasks (tickets) for engineering once spec is in place (e.g., “Implement AI Marking server action,” “Add UI for AI batch scoring”), referenced from the plan if helpful.
