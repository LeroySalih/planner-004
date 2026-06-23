# Lesson Activities Sidebar — Design

## Problem

The "Scheduled Activities" list in `LessonActivitiesManager` can grow long. There is no quick way to see all activity titles at a glance, jump to one, reorder, or delete it without scrolling through the full list.

## Goals

- Add a sticky left sidebar to the lesson activities panel listing every activity's title in order.
- Sidebar supports drag-and-drop reordering, in sync with the existing main list.
- Sidebar supports deleting an activity directly.
- Clicking an activity title in the sidebar scrolls the main list to that activity.
- Existing main-list drag handles and delete buttons remain unchanged (both UIs stay available).
- Delete from the sidebar matches current behavior: no confirmation dialog (the main list deletes immediately today).

## Non-goals

- No new server actions, schemas, or persistence changes — this is a client-side UI addition.
- No change to reorder/delete business logic, only reuse of existing handlers.

## Design

### Layout

`LessonActivitiesManager`'s "Scheduled Activities" `<section>` becomes a two-column flex layout:

- Left column: sidebar, fixed width (~240px), `sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto`.
- Right column: existing `<ul>` of activity `<li>` cards, unchanged.

The "Add Activity" toolbar section above stays full-width, outside the two-column layout.

If `activities.length === 0`, the sidebar is not rendered (mirrors the main list's existing empty-state message).

### Sidebar rows

One row per activity, rendered from the same `activities` state array used by the main list (already kept ordered via `order_by` / `sortActivities`). Each row contains:

- Drag handle (`GripVertical` icon, `draggable`) — wired to the existing `handleDragStart(activity.activity_id)` / `handleDragEnd` handlers.
- Activity title, truncated with `truncate`, wrapped in a `button` — `onClick` scrolls the corresponding main-list item into view.
- Delete button (`Trash2` icon) — calls the existing `handleDeleteActivity(activity.activity_id)` directly, same as the main list (no added confirmation).

The row `<li>`/`<div>` itself is also a drop target: reuse `handleDragOver(activity.activity_id)`, `handleDragEnter` (same handler), `handleDragLeave(activity.activity_id)`, `handleDrop(activity.activity_id)` — identical wiring to the main list's `<li>`. Because both lists render from the same `activities` state and call into the same `reorderActivities` / `submitReorder` flow, dragging in either list stays in sync.

A bottom drop zone reusing the existing `END_DROP_ID` sentinel lets users drag an activity to the very end from the sidebar, matching the main list's existing "drop at end" zone.

Visual feedback (`isDragging`, `isDragOver` derived from `draggingId`/`dragOverId` state) mirrors the main list's styling (opacity change while dragging, highlighted border on drag-over).

### Scroll-to-activity

Add a ref map: `const activityRefs = useRef<Map<string, HTMLLIElement>>(new Map())`.

Each main-list `<li key={activity.activity_id}>` gets a `ref` callback that sets/deletes its entry in the map keyed by `activity_id`.

Sidebar title click handler:

```ts
const node = activityRefs.current.get(activity.activity_id)
node?.scrollIntoView({ behavior: "smooth", block: "start" })
```

### State / handlers reused (no new logic)

- `activities`, `draggingId`, `dragOverId` state
- `handleDragStart`, `handleDragOver`, `handleDragLeave`, `handleDrop`, `handleDragEnd`
- `handleDeleteActivity`
- `sortActivities`, `reorderActivities`, `applyOrderToActivities`, `submitReorder` (unchanged, invoked indirectly via the same state-update path the main list already uses)

### New code

- Ref map for scroll targets.
- Sidebar JSX block (new, self-contained — no new component file needed given the existing file already centralizes all activity manager logic; sidebar is just another rendered fragment inside `LessonActivitiesManager`'s return).
- Two-column flex wrapper around the existing "Scheduled Activities" section.

## Testing

- Manual verification via dev server: reorder from sidebar, reorder from main list, confirm both stay in sync and persist (toast "Activity order update queued" / success on delete).
- Click a sidebar title and confirm the page scrolls to the right card.
- Delete from sidebar and confirm the activity disappears from both lists.
- No Playwright test required unless requested — this app currently has no unit test infra for component-level drag/drop interactions; E2E coverage would need a new spec under `tests/` if desired later (out of scope for this change).
