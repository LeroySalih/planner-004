# Plan: File Upload Queue & Status Lifecycle

## Goal
Introduce a pg-backed status lifecycle for file upload activities and a teacher-facing `/queue` page to manage downloads and status updates while keeping UI server-rendered and updates fire-and-forget.

## Step Breakdown
1. **Model & Schema**
- Add a `submission_status` text column for file submissions with a check constraint limiting values to `inprogress`, `submitted`, `completed`, `rejected`; default to `inprogress` on inserts and replacements.
- Extend Zod types in `src/types/index.ts` to mirror the new status field and any queue-specific payloads.

2. **Server Data Layer (pg-only)**
   - Create pg client helpers for file submission reads/writes and queue listings (filtered by group/unit/lesson/activity) plus a bulk status update endpoint.
   - Add server actions (wrapped in `withTelemetry`) that expose: setting pupil status (`inprogress` → `submitted`), teacher status updates (`completed`/`rejected`), queue listings, and a zip download stream builder using stored file paths.

3. **Pupil Activity UI**
   - Update the file upload activity component so every upload sets status to `inprogress` (even on replacements) before processing.
   - Keep the status drop-down visible; hook it to the new submit-status action with `useActionState` and optimistic toasts, ensuring the UI stays responsive.

4. **Teacher Queue Page (/queue)**
- Build a server component page with SSR filters (Group, Unit, Lesson, Activity) that load their options server-side.
- Render the queue list (pupil, file name/size, timestamp, status) and wire row-level status selectors to fire-and-forget teacher update actions, allowing transitions to any status value.
- Add a “Download all as zip” button that calls the zip server action and streams the archive; handle missing files gracefully.

5. **Telemetry, Auth, and Quality**
   - Ensure actions enforce teacher auth where needed and log telemetry timing deltas to `logs/telem_<timestamp>.log` when enabled.
   - Smoke-test pupil upload flow and `/queue` page interactions; document the workflow in `AGENTS.md` or relevant specs after implementation.
