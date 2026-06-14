# Group Items Activity — Design Spec

**Date:** 2026-06-14
**Status:** Approved

## Overview

New scorable activity type, `group-items`. A teacher defines 2-4 groups and 2-12 items, assigning each item to its correct group. Pupils see the groups as boxes in a row, with all items shuffled into an "item bank" strip below. Pupils drag items into group boxes (and can drag items back to the bank, or between groups). Scoring is the fraction of items placed in their correct group (0-1, partial credit).

This follows the existing `matcher` activity's pattern closely (schemas, server action, scoring wiring) but introduces drag-and-drop via `@dnd-kit/core` — a new dependency, chosen over native HTML5 DnD (used for lesson reordering) because pupils may use touch devices.

## Data Model (`src/types/index.ts`)

```ts
export const GroupItemsGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
});

export const GroupItemsItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(200),
  imageUrl: z.string().url().nullable().optional(),
  groupId: z.string().min(1), // the CORRECT group for this item
});

export const GroupItemsActivityBodySchema = z
  .object({
    groups: z.array(GroupItemsGroupSchema).min(2).max(4),
    items: z.array(GroupItemsItemSchema).min(2).max(12),
  })
  .passthrough();

export const GroupItemsSubmissionBodySchema = z
  .object({
    itemOrder: z.array(z.string()).default([]),
    placements: z.record(z.string(), z.string().nullable()).default({}),
    score: z.number().min(0).max(1).nullable().default(null),
    is_correct: z.boolean().default(false),
    teacher_override_score: z.number().min(0).max(1).nullable().optional(),
    teacher_feedback: z.string().nullable().optional(),
    success_criteria_scores: z
      .record(z.string(), z.number().min(0).max(1).nullable())
      .default({}),
  })
  .passthrough();

export type GroupItemsGroup = z.infer<typeof GroupItemsGroupSchema>;
export type GroupItemsItem = z.infer<typeof GroupItemsItemSchema>;
export type GroupItemsActivityBody = z.infer<typeof GroupItemsActivityBodySchema>;
export type GroupItemsSubmissionBody = z.infer<typeof GroupItemsSubmissionBodySchema>;
```

`items[].groupId` is the answer key (correct group) and must never be sent to the pupil-facing component beyond what's needed to compute placements on the server — the activity body is still fetched server-side for scoring, but the pupil component reads only `id`, `text`, `imageUrl` per item plus `groups` (id/name).

## Scoring

`score = (count of items where placements[item.id] === item.groupId) / items.length`, clamped to `[0, 1]`. Unplaced items (`placements[id]` missing or `null`) score 0 for that item. `is_correct = (score === 1)`.

Computed server-side in `upsertGroupItemsSubmissionAction`, recomputed on every save.

### `compute_submission_base_score` (SQL)

New migration `src/migrations/0XX-group-items-activity-score.sql`, adding a branch (also reflected in `src/migrations/schema.sql`):

```sql
elsif normalized_type = 'group-items' then
  auto_score := safe_numeric(body->>'score');
```

This sits alongside the existing `multiple-choice-question`/`matcher` and `short-text-question` branches, after the `teacher_override_score`/`override_score` check (unchanged).

### Activity list scoring (`src/lib/scoring/activity-scores.ts`)

Add a `group-items` branch parallel to the `matcher` branch:
- Parse with `GroupItemsSubmissionBodySchema`.
- `auto = parsed.data.score ?? 0`.
- `override = parsed.data.teacher_override_score` if present.
- `success_criteria_scores` via `normaliseSuccessCriteriaScores`, filled with `override ?? auto`.

### `dino.config.ts`

Add `"group-items"` to `SCORABLE_ACTIVITY_TYPES`.

## Teacher Editor (`src/components/lessons/lesson-activities-manager.tsx`)

- Add `{ value: "group-items", label: "Group Items" }` to the activity type dropdown.
- New helpers in `src/components/lessons/activity-view/utils.ts`, mirroring the matcher helpers:
  - `createDefaultGroupItemsBody()` — 2 empty groups, 2 empty items.
  - `getGroupItemsBody(activity)` — parse `body_data`, fall back to default.
  - `normalizeGroupItemsBody(body)` — clamp to 2-4 groups / 2-12 items, ensure ids, drop items referencing removed groups (reassign to first remaining group).
- New `groupItemsBody` state (`useState<GroupItemsActivityBody>`), wired into the same three reset points as `matcherBody` (load existing activity, new activity, cancel edit).
- **Groups section**: list of name inputs (2-4 rows), add/remove buttons disabled at min/max.
- **Items section**: list of item rows (2-12), each with:
  - Text input (item label)
  - Optional "Image URL" text input (`imageUrl`, plain external URL — no upload pipeline, matching the existing unused `McqOptionBody.imageUrl` field shape)
  - `<Select>` for the correct group (`groupId`), options populated from current `groupItemsBody.groups`
  - Remove button (disabled at minimum of 2 items)
  - "Add item" button (disabled at 12)
- Validation (`groupItemsValidationMessage`, like `matcherValidationMessage`): every item needs non-empty text and a `groupId` matching an existing group; every group needs a non-empty name.
- `prepareGroupItemsBodyForSave(groupItemsBody)` — validates and returns `{ bodyData, error }`, called from the save handler's `type === "group-items"` branch.

## Pupil UI (`src/components/pupil/pupil-group-items-activity.tsx`)

New client component, structured like `pupil-matcher-activity.tsx`:

- **Props**: `lessonId`, `activity`, `pupilId`, `canAnswer`, `initialItemOrder: string[]`, `initialPlacements: Record<string, string | null>`.
- **Layout** (Option A from brainstorm): group boxes rendered in a row across the top (one `useDroppable` zone per group, id = `groupId`); an "item bank" strip below, also a `useDroppable` zone (id = `"bank"`).
- **Item order**: `itemOrder` = `initialItemOrder` if it covers all current `activity` items 1:1, else a fresh `shuffle()` of item ids (matcher pattern) — generated client-side, persisted to the server on first save so reloads are stable.
- **Placements state**: `Record<itemId, groupId | null>`, initialized from `initialPlacements` (missing entries default to `null` = in the bank).
- **Rendering**: each item is a `useDraggable` chip (id = item id) showing `text` and, if `imageUrl` is set, a small thumbnail (`<img>`, capped size e.g. 48px). An item renders inside its placed group's box if `placements[id]` is a known group id, otherwise in the bank, in `itemOrder` order.
- **DnD**: `@dnd-kit/core` `DndContext` with `PointerSensor` (`activationConstraint: { distance: 8 }` to avoid accidental drags from taps/scrolls — works for mouse and touch). On `onDragEnd`:
  - `over.id` is either a `groupId` or `"bank"`.
  - Update `placements[item.id] = over.id === "bank" ? null : over.id` (optimistic local update).
  - Call `upsertGroupItemsSubmissionAction({ activityId, userId, itemOrder, placements: nextPlacements })`.
- **No correctness reveal** (matches the recent matcher fix `0936e16`): footer shows only a "Saving…" spinner / "Saved" badge — never colors items green/red or shows the score, regardless of `canAnswer`.
- **Read-only mode** (`canAnswer = false`): items render in their current bank/group positions but are not draggable (`useDraggable` disabled).

## Server Action (`src/lib/server-actions/submissions.ts`)

New `upsertGroupItemsSubmissionAction(input)`, mirroring `upsertMatcherSubmissionAction`:

1. Input schema `GroupItemsSubmissionInputSchema = { activityId, userId, itemOrder: string[], placements: Record<string, string | null> }`.
2. Load `body_data, lesson_id` from `activities`, parse with `GroupItemsActivityBodySchema`; 404/invalid → error result.
3. Validate `itemOrder` covers every `items[].id` exactly once (else error "Activity layout is no longer valid for this submission" — same message as matcher).
4. Sanitize `placements`: drop entries for unknown item ids; coerce unknown group ids to `null`.
5. Compute `score` and `is_correct` per the Scoring section.
6. `success_criteria_scores` via `normaliseSuccessCriteriaScores`, filled with `score`.
7. Build `GroupItemsSubmissionBodySchema.parse({...})`, upsert into `submissions` (update-if-exists-else-insert, same logic/ordering as the matcher action including `logActivitySubmissionEvent` and `emitSubmissionEvent`).

Re-export from `src/lib/server-updates.ts`.

## Activity View Wiring (`src/components/lessons/activity-view/index.tsx`)

- New `GroupItemsPresentView` component — teacher-facing read-only preview, parallel to `MatcherPresentView`: renders each group with the items whose `groupId` matches it (i.e., shows the answer key directly, since this is the teacher's editor preview, not the pupil view).
- Add `activity.type === "group-items"` branches:
  - Preview render path (~line 1232 equivalent) → `<GroupItemsPresentView />`.
  - Edit-form summary render path (~line 1405 equivalent) → list groups and their assigned items as text.

## Pupil Lesson Page Wiring (`src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`)

- For `activity.type === "group-items"`, parse the pupil's existing submission (if any) with `GroupItemsSubmissionBodySchema`, extract `itemOrder`/`placements`, pass as `initialItemOrder`/`initialPlacements` to `<PupilGroupItemsActivity />` — same pattern as matcher's `initialLayout`/`initialAnswers`.

## Dependencies

- Add `@dnd-kit/core` to `package.json`.

## Out of Scope

- Image upload pipeline for item images (URL-only, like the existing unused MCQ option `imageUrl` field).
- Revealing per-item correctness to pupils (consistent with matcher's no-early-reveal behavior).
- More than 4 groups or 12 items (would require layout/scroll redesign).
