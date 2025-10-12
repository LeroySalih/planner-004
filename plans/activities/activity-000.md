# Activity Success Criteria Integration Plan

## 1. Types & Data Contracts
- Extend planner activity schemas in `src/types/index.ts` so every activity body carries a `successCriteriaIds: string[]` (default to empty), reusing existing `SuccessCriteriaSchema` identifiers.
- Document the `activity_success_criteria` join contract (columns: `activity_id`, `success_criteria_id`, timestamps) and add a Supabase migration plan if the table or indexes are missing; note RLS policies granting teachers full CRUD and blocking pupils.
- Update discriminated unions (`LessonActivitySchema`, `ActivityBody`, submission payloads) and any helper types (`NormalizedLessonActivity`) to include the new array, plus widen TypeScript utilities that currently spread `activity.body`.

## 2. Server Actions & Persistence
- Identify server actions mutating activities (e.g., `src/lib/server-actions/lesson-activities.ts`) and update payload parsing to accept the `successCriteriaIds` array via Zod.
- Add persistence helpers that diff old/new IDs and issue Supabase upserts/deletes against `activity_success_criteria` within the existing transaction or optimistic update flow.
- Re-export any new helpers from `src/lib/server-updates.ts`, ensuring teacher-only actions enforce `requireTeacherProfile` before modifying links.

## 3. Data Fetching & Normalization
- When loading lessons/activities server-side, join against `activity_success_criteria` (or make a follow-up query) and hydrate `successCriteriaIds` so UI consumers receive the linked titles.
- If lessons do not currently hydrate success criteria collections, plan an additional fetch for the lesson’s success criteria list and memoize it at the page/component boundary.
- Update normalization utilities (`src/lib/server-actions/lessons.ts`, `src/components/lesson/activity-view/utils.ts` or equivalents) to pass through both IDs and pre-fetched `SuccessCriteria` objects where required.

## 4. Authoring UI (Edit Mode)
- Enhance the activity editor surface to render a multi-select or checkbox list of the lesson’s available success criteria; selection is by title only as per spec, showing disabled state if none exist.
- Wire selections into the existing optimistic update machinery so toggling criteria triggers the activity update action with the new array.
- Provide inline feedback for validation errors (e.g., Supabase failure), reuse existing toast pattern, and default to an empty selection for legacy activities.

## 5. Presentation & Pupil Views
- In short mode and present mode components, render the linked success criteria titles (badge or list) beneath the activity header, falling back to “No success criteria linked” when empty.
- Ensure pupil-facing components can read the hydrated titles without exposing editing controls; cache results client-side if the success criteria list is large.
- Double-check downstream summaries (assignment or lesson dashboards) so they respect the new linkage when aggregating criteria coverage.

## 6. Validation, Testing & Docs
- Update Playwright specs covering activity authoring/presentation to assert success criteria selection and display; add a focused test for persisting multiple selections.
- Consider integration tests (or manual QA checklist) verifying the join table updates correctly on add/remove operations and that inactive criteria do not leak into selection lists.
- Append the change to `specs/acticvites.md` and `Planner Agents Playbook`, outlining the new contract and authoring flow; remind future work to run `npm run lint` and targeted Playwright suites.

## Open Questions
- None.
