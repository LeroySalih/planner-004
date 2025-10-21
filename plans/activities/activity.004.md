# Activity Score Override Text Entry Plan (v4)

> Requirement (25-10-21): Activity scoring overrides currently expose three preset buttons (zero, partial, full). Teachers now need a textbox to enter an exact percentage override (0–100). The value must persist as a 0–1 score in Supabase after dividing by 100.

## 1. Product + UX Alignment
- Confirm which teacher-facing surfaces show the override controls today (`LessonActivityView` short mode, `LessonSidebar` edit drawer, any assignment scoring panes) so the textbox appears consistently—wherever the preset buttons render, the textbox must accompany them.
- Decide on microcopy and validation feedback (e.g. helper text, error state when the entry is outside 0–100) while treating empty input as 0 by default.
- Align the layout so the buttons shrink slightly and sit on the same row as the textbox without breaking existing responsive behaviour.

## 2. State & Data Handling
- Trace current override flow: identify where scores are stored in component state (likely via `useTransition` setters) and how `overrideShortTextSubmissionScoreAction` and related server actions consume numeric overrides.
- Update local state to track manual percentage input separately from stored 0–1 score; normalise/parsing should occur before invoking server actions.
- Ensure Zod schemas and server actions continue to expect 0–1 values; add explicit conversion (`percent / 100`) and validation before submission. Guard against NaN and floating-point rounding that could exceed boundaries.
- Decide how the input synchronises when a teacher clicks preset buttons or when a score loads from the database (the textbox must always mirror button presses and display `score * 100` with no special precision rules).

## 3. UI Implementation
- Introduce a numeric input component (reuse `Input` with `type="number"`) on the same row as the existing buttons. Apply Tailwind utility classes consistent with current layout while shrinking the buttons to make room.
- Implement client-side validation (restrict keypresses, clamp values) and show inline error or disabled save button when invalid.
- Ensure accessibility: label the textbox clearly (“Override (%)”), associate `aria` attributes, and support keyboard entry plus blur submission patterns (Enter/Save button).
- Handle empty input by defaulting the override to 0 while keeping the UI state consistent.

## 4. Server Actions & Persistence
- Review server actions that accept overrides (e.g. `overrideShortTextSubmissionScoreAction`, `markShortTextActivityAction`) for any assumptions about discrete button selections; confirm they already accept arbitrary 0–1 floats.
- If needed, adjust API payload typing so fractional overrides remain precise (simple `percent / 100` conversion is sufficient). Ensure optimistic UI updates mirror the conversion logic so the UI immediately reflects the typed percentage.

## 5. Testing & QA
- Perform manual QA: verify entering values like `37.5%` stores 0.375, preset buttons still map to 0/partial/full while updating the textbox, empty input defaults to 0, and invalid entries (<0 or >100) surface inline validation feedback.

## 6. Documentation & Rollout
- Update `specs/activities.md` and any in-app help/tooltips with the new override guidance.
- Notify stakeholders of the more granular override capability; call out any rounding rules in release notes.
- Validate translations/localisation requirements if UI copy changes, and note any migration/seed impacts (should be none).
