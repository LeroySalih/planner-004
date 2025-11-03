# Lesson Objectives Sidebar Enhancements Plan

## Spec Gaps
- `src/components/lessons/lesson-objectives-sidebar.tsx:141` renders copy and objective checkboxes but lacks the required filter input, so teachers cannot narrow learning objectives or success criteria by text.
- `src/components/lessons/lesson-objectives-sidebar.tsx:147` has no entry point to create a new learning objective; the spec calls for an "Add LO" control that opens a secondary sidebar.
- `src/components/lessons/lesson-objectives-sidebar.tsx:152` renders only a single sheet; there is no nested sidebar flow to capture the title/spec reference for a new learning objective or to auto-link it to the curriculum.
- `src/components/lessons/lesson-objectives-sidebar.tsx:183` lists success criteria but provides no affordance to create a new criterion beneath an LO; the spec calls for a per-LO "New SC" button that opens a creation sidebar with title and level inputs.
- `src/lib/server-actions/learning-objectives.ts:271` and `src/lib/server-actions/learning-objectives.ts:428` expose creation helpers but they hydrate unit-level context and return to `/units/[unitId]`; nothing surfaces a lesson-centric create flow nor revalidates the lesson detail route.
- `src/lib/server-updates.ts:29` forwards existing actions but there are no lesson-facing helpers to create learning objectives or criteria, and no telemetry scaffolding keyed to the lesson path.

## Implementation Plan
1. **Map required data and contracts**
   - Confirm `LessonWithObjectives` carries curriculum, unit, and lesson identifiers needed to associate new learning objectives and success criteria; extend the server action backing `/lessons/[lessonId]` if additional IDs are missing.
   - Add Zod schemas for lesson-driven LO/SC creation payloads in `src/types/index.ts`, reusing existing shapes where possible and ensuring they cover title, level, spec ref, and curriculum linkage.
2. **Introduce sidebar state management**
   - In `lesson-objectives-sidebar.tsx`, add local state to track the search filter, currently selected LO for creation, and visibility flags for the add-LO and add-SC sheets.
   - Apply the filter string to `objectiveSelections` with memoized fuzzy/starts-with matching against LO titles, AO titles, and success criterion descriptions.
3. **Add “Add LO” workflow**
   - Render a primary button near the header to launch a new sidebar component (e.g., `LessonObjectiveCreateSidebar`) that wraps a Radix sheet and controlled form with `useActionState` so submit buttons show pending loaders.
   - Reuse or wrap the existing `createLearningObjectiveAction`, augmenting it to accept curriculum ID/unit ID from the lesson context, emit telemetry that includes path hints (`/lessons/...`), and revalidate both the lesson detail page and learning objectives data.
   - After creation, merge the new LO into local state, auto-select newly created success criteria, and bring the focus back to the parent sidebar.
4. **Add per-LO “New SC” workflow**
   - For each rendered learning objective entry, render a tertiary “New SC” button that opens another sidebar (e.g., `SuccessCriterionCreateSidebar`) scoped to that objective.
   - Introduce a server action (or extend existing ones) to insert a success criterion for a given learning objective, defaulting `level` within the 1–9 range and linking to the lesson’s unit where appropriate; ensure telemetry logging mirrors the TELEM settings and revalidates lesson data.
   - On success, update the in-memory objective list, keep the parent selection toggles in sync, and automatically check the new criterion for the lesson.
5. **Hook up telemetry and barrel exports**
   - Ensure both creation flows record start/end timestamps plus authentication timing, gated by `TELEM_ENABLED` and `TELEM_PATH`, writing to `logs/telem_<timestamp>.log`.
   - Export the new lesson-facing actions through `src/lib/server-updates.ts` so client components can import them alongside existing setters.
6. **Validation, loading states, and UX polish**
   - Guard against duplicate titles/spec refs with inline validation errors surfaced through the form components, and enforce numeric level values between 1 and 9.
   - Provide optimistic toast feedback and disable close buttons while submissions are pending to avoid double submits.
   - Extend Playwright coverage (or document gaps) to cover filter behaviour and nested creation flows once they exist.

## Open Questions
- None.
