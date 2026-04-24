# Display Section Activity — Design

**Date:** 2026-04-24
**Status:** Approved (design phase)

## Summary

Add a new non-scorable activity type, `display-section`, that marks the start of a
new section within a lesson. A section consists of the `display-section` activity
itself and every activity following it (in `order_by` order) until the next
`display-section` activity is encountered or the list ends. Sections are flat —
not hierarchical.

The section's ordinal index (1, 2, 3, …) is **auto-computed** at render time from
position in the `order_by`-sorted activity list, not stored.

## Scope

### In scope
- New activity type registered as non-scorable.
- Editor entry allowing teachers to create/edit a display section with a title and
  rich-text description.
- Visually distinct rendering in the activities list (short view) and presentation
  view, including the auto-computed section index.
- Server-side body validation for the new type.

### Out of scope
- Wrapping subsequent activities in a grouped/indented container (Approach 2).
- Collapsible sections (Approach 3).
- Reporting, filtering, or analytics by section.
- Any schema migration — uses the existing `activities` table as-is.

## Data model

Uses the existing `public.activities` table. No migration required.

| Field         | Value                                                     |
|---------------|-----------------------------------------------------------|
| `type`        | `"display-section"`                                       |
| `title`       | Section name (teacher-entered)                            |
| `body_data`   | `{ "description": string }` — HTML/markdown rich text     |
| `is_summative`| Always `false` (enforced via non-scorable type list)      |
| `order_by`    | Standard activity ordering; drives the section's index    |

The section index is derived at render time — not persisted.

### Type registration

- `src/dino.config.ts` — add `"display-section"` to `NON_SCORABLE_ACTIVITY_TYPES`.

### Zod schema

In `src/lib/server-actions/lesson-activities.ts`:

```ts
const DisplaySectionActivityBodySchema = z.object({
  description: z.string().default(""),
});
```

Add a case in `normalizeActivityBody()`'s switch statement that validates
incoming `body_data` against this schema and returns the parsed result.

## Server behaviour

The existing create/update/list/reorder/delete server actions require no changes
beyond the new entry in `normalizeActivityBody()`. `body_data` is a `jsonb`
column and the pipeline already handles arbitrary activity types generically.

`is_summative` is enforced `false` for non-scorable types via existing
`assertSummativeEligibleActivityType` / non-scorable validation — no special-case
code needed.

## Editor UI

File: `src/components/lessons/lesson-activities-manager.tsx`.

- Add `{ value: "display-section", label: "Display Section" }` to the
  `ACTIVITY_TYPES` array.
- When the selected type is `display-section`, the editor form shows:
  - Title input (existing field).
  - Rich-text editor for `description`. Reuse the same rich-text editor already
    used by the `text` activity type — do not introduce a new editor.
- On submit, `bodyData` is `{ description: <editor value> }`.

## Index computation

File: `src/components/lessons/activity-view/utils.ts`.

Add two helpers:

```ts
export function getDisplaySectionBody(activity): { description: string } {
  // Pull body_data.description, default to "".
}

export function computeSectionIndexMap(
  activities: LessonActivity[],
): Map<string, number> {
  // Walk activities in order_by order.
  // For each activity whose type is "display-section",
  // assign the next sequential index (1, 2, 3, ...) keyed by activity_id.
}
```

The map is built once per render at the parent level (list or presentation) and
read by the view components via a new optional prop `sectionIndex?: number`.

## Rendering

File: `src/components/lessons/activity-view/index.tsx`.

### Short view (`ActivityShortView`)

Add `else if (activity.type === "display-section")` branch.

- Visually distinct from a standard activity card: bigger typography, accent
  border or muted background, clearly signalling "section header" rather than
  "lesson activity".
- Heading text: `Section {sectionIndex}: {title}`. If `sectionIndex` is missing
  (edge case, e.g. an orphaned preview), fall back to just `{title}`.
- Description rendered via the existing `getRichTextMarkup()` helper, same as
  the `text` activity's preview.

### Presentation view (`ActivityPresentView`)

Add `if (activity.type === "display-section")` branch, returning the content
wrapped with the existing `wrap()` helper so spacing/success-criteria handling
match other activity types.

- Full-screen layout:
  - Small label: `Section {sectionIndex}`.
  - Large heading: section title.
  - Prose-styled description block below, using the same `prose prose-lg
    dark:prose-invert` class stack as the `text` activity's present view.

### Prop wiring

- Add `sectionIndex?: number` to `ActivityShortView` and `ActivityPresentView`.
- Every caller that renders a list of activities computes
  `computeSectionIndexMap(sortedActivities)` once and passes the looked-up index
  when rendering a `display-section` activity. Callers to update:
  - `src/components/lessons/lesson-activities-manager.tsx`
  - `src/app/lessons/[lessonId]/activities/page.tsx` (or wherever the activities
    overview renders, per current structure)
  - The presentation view caller (lesson activity presentation client)
- For non-`display-section` activities, the prop is simply omitted.

## Error / edge cases

- **Empty description**: allowed (Zod default `""`). Renders a header with title
  only, no description block.
- **Empty title**: enforced the same way as other activities (existing validation
  requires a non-empty title on create/update).
- **Activity list with no sections**: behaviour unchanged — no headers rendered,
  map is empty.
- **Activity list starting with non-section activities**: those activities appear
  before "Section 1" header with no implicit "untitled" section — matches user
  spec ("activities following this section will be part of the same section").
- **Reordering**: since the index is derived from `order_by` at render time, any
  reorder that moves a `display-section` renumbers automatically.

## Testing

- No unit test infrastructure exists in this repo; rely on Playwright E2E for
  integration coverage. Manual verification:
  - Create a `display-section` activity in a lesson — renders as header card.
  - Add a second `display-section` later in the list — indices become 1 and 2.
  - Reorder so the later section moves before the first — indices update.
  - Delete (deactivate) a section — remaining sections renumber.
  - Present the lesson — section activities show full-screen with index, title,
    description.
  - Edit the description — rich text renders correctly on save.

## Files touched (summary)

- `src/dino.config.ts` — register non-scorable type.
- `src/lib/server-actions/lesson-activities.ts` — add body schema + switch case.
- `src/components/lessons/lesson-activities-manager.tsx` — type option + editor
  branch.
- `src/components/lessons/activity-view/utils.ts` — `getDisplaySectionBody`,
  `computeSectionIndexMap`.
- `src/components/lessons/activity-view/index.tsx` — short view + present view
  branches + `sectionIndex` prop.
- Activities-page and presentation-client callers — compute index map and pass
  prop.
