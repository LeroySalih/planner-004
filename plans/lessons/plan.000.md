# Lesson Detail Alignment Plan

## Spec Gaps
- The lesson header currently renders a gradient hero with a back button and previous/next shortcut links, while the status badge lives inside the summary card and there is no lesson-switch dropdown (`src/components/lessons/lesson-detail-client.tsx:71`-`src/components/lessons/lesson-detail-client.tsx:134`).
- Learning objectives show every success criterion attached to the objective, not just the criteria linked through the lesson-success table, so the hierarchy overstates coverage (`src/components/lessons/lesson-detail-client.tsx:147`-`src/components/lessons/lesson-detail-client.tsx:188`).
- The edit sidebar only supports selecting objectives at the LO level; there is no per-success-criterion toggle or “select all criteria for an LO” affordance (`src/components/lessons/lesson-objectives-sidebar.tsx:30`-`src/components/lessons/lesson-objectives-sidebar.tsx:129`).
- Server actions accept objective IDs, not success-criterion links, so we lack an API surface to persist SC-level associations (`src/lib/server-actions/lessons.ts:200`-`src/lib/server-actions/lessons.ts:320`).
- Activities management lives inline in a card; “Show Activities” pushes to a new route and “Add Activity” opens a modal sheet, but there is no dedicated side bar workflow as described, and the layout does not expose a two-button panel (`src/components/lessons/lesson-activities-manager.tsx:912`-`src/components/lessons/lesson-activities-manager.tsx:1038`).
- Lesson links fetch metadata on paste rather than on blur, so the auto-fill behaviour does not match the spec’s trigger point (`src/components/lessons/lesson-links-manager.tsx:72`-`src/components/lessons/lesson-links-manager.tsx:100`).
- Lesson file uploads provide toast feedback but no progress bar, falling short of the spec’s upload progress requirement (`src/components/lessons/lesson-files-manager.tsx:71`-`src/components/lessons/lesson-files-manager.tsx:158`).

## Implementation Plan
1. **Data contracts**
   - Extend the lesson read action to return per-criterion associations, the unit lesson list for the dropdown, and a curriculum-wide learning objective/success-criteria collection (`src/app/lessons/[lessonId]/page.tsx:38`-`src/app/lessons/[lessonId]/page.tsx:104`).
   - Introduce supporting server actions (or extend existing ones) to fetch all curriculum learning objectives/success criteria, and expose them via the server updates barrel (`src/lib/server-actions/learning-objectives.ts`, `src/lib/server-updates.ts`).
   - Introduce a server action that upserts lesson-success-criteria links and update types/Zod schemas accordingly (`src/lib/server-actions/lessons.ts:200`-`src/lib/server-actions/lessons.ts:320`, `src/types/index.ts`).
2. **Header and navigation**
   - Rework the client header (keeping the existing visual styling as the standard), surface the status pill inline, add a select input populated from unit lessons for quick navigation, and remove the existing back button, summary card, and previous/next shortcut buttons (`src/components/lessons/lesson-detail-client.tsx:71`-`src/components/lessons/lesson-detail-client.tsx:145`).
3. **Learning objectives display**
   - Render objectives using the lesson-success-criteria collection so only linked success criteria appear, preserving indentation and inactive badges where relevant (`src/components/lessons/lesson-detail-client.tsx:147`-`src/components/lessons/lesson-detail-client.tsx:188`).
4. **Edit objectives sidebar**
   - Replace the LO-only checkbox list with a hierarchical selector that lets teachers toggle individual success criteria, with an LO-level shortcut to toggle all children, preselecting all currently linked criteria on open, and wire it to the new server action (`src/components/lessons/lesson-objectives-sidebar.tsx:30`-`src/components/lessons/lesson-objectives-sidebar.tsx:129`).
5. **Activities workflow**
   - Keep the activities list and primary buttons in the main content column, refining the existing layout to emphasise the Show/Add controls while preserving drag/drop, delete, and advanced management features (`src/components/lessons/lesson-activities-manager.tsx`).
6. **Lesson links metadata**
   - Trigger metadata fetch on blur for both the create and edit URL inputs only when the value changed and parses as a valid URL; clear invalid URLs and keep paste support as a progressive enhancement (`src/components/lessons/lesson-links-manager.tsx:72`-`src/components/lessons/lesson-links-manager.tsx:174`).
7. **Lesson file uploads**
   - Add aggregate batch upload progress feedback (e.g., via progress bar tracking the combined transfer) while retaining the existing drag/drop and action buttons (`src/components/lessons/lesson-files-manager.tsx:71`-`src/components/lessons/lesson-files-manager.tsx:198`).
8. **Testing and telemetry**
   - Backfill Playwright coverage for the revamped interactions and ensure any new server actions emit telemetry in line with the environment flags.

## Current Functionality Not Covered by the Spec
- Back-to-list button, gradient hero styling, and summary card (all to be removed) (`src/components/lessons/lesson-detail-client.tsx:71`-`src/components/lessons/lesson-detail-client.tsx:145`).
- Metadata auto-fill on paste for lesson links (`src/components/lessons/lesson-links-manager.tsx:72`-`src/components/lessons/lesson-links-manager.tsx:100`).
- Drag-and-drop upload affordance without batch progress indicator for lesson files (`src/components/lessons/lesson-files-manager.tsx:137`-`src/components/lessons/lesson-files-manager.tsx:198`).

## Open Questions
- None at this time.
