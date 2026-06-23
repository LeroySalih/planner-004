# Lesson Activities Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sticky left sidebar to `LessonActivitiesManager` that lists every activity's title, supports drag-and-drop reorder and delete (reusing existing handlers), and scrolls the main list to an activity when its sidebar title is clicked.

**Architecture:** Pure client-side addition to the existing `src/components/lessons/lesson-activities-manager.tsx` file. No new files, no new server actions. A ref map tracks each main-list `<li>` DOM node keyed by `activity_id` for scroll targeting. The sidebar reuses the component's existing `handleDragStart`, `handleDragOver`, `handleDragLeave`, `handleDrop`, `handleDragEnd`, `handleDeleteActivity`, `draggingId`, `dragOverId`, and `activities` state — no new reorder/delete logic.

**Tech Stack:** React 19, Next.js 15 App Router, TypeScript, Tailwind CSS v4, lucide-react icons (already imported: `GripVertical`, `Trash2`).

---

## Spec reference

Design doc: `docs/superpowers/specs/2026-06-23-lesson-activities-sidebar-design.md`

## Background for the engineer

`LessonActivitiesManager` (in `src/components/lessons/lesson-activities-manager.tsx`) is a large client component (~4950 lines) that renders an "Add Activity" toolbar and a "Scheduled Activities" list. Each activity is an `<li>` with a drag handle, preview, edit button, and delete button. Drag-and-drop reorder already works via `handleDragStart`/`handleDragOver`/`handleDragLeave`/`handleDrop`/`handleDragEnd`, which read/write `draggingId`/`dragOverId` state and call `setActivities` with the result of `reorderActivities(...)`. A `useEffect` elsewhere in the file watches `pendingReorderRef` and calls `submitReorder` to persist — you do not need to touch that path; reusing the same handlers is enough to keep persistence working.

You will NOT be writing automated tests — this codebase has no component-level test infra for drag-and-drop (per the design spec, "Testing" section). Verification is manual: run `pnpm lint`, `pnpm build` (or just `pnpm dev` and click around) after each task.

---

### Task 1: Add a ref map for scroll-to-activity targeting

**Files:**
- Modify: `src/components/lessons/lesson-activities-manager.tsx`

- [ ] **Step 1: Add the ref map declaration**

Find this existing line near the top of the component body (around line 147):

```ts
  const pendingReorderRef = useRef<{ next: LessonActivity[]; previous: LessonActivity[] } | null>(null)
```

Add a new ref declaration directly after it:

```ts
  const pendingReorderRef = useRef<{ next: LessonActivity[]; previous: LessonActivity[] } | null>(null)
  const activityListItemRefs = useRef<Map<string, HTMLLIElement>>(new Map())
```

- [ ] **Step 2: Add a scroll-to-activity callback**

Find the `handleDeleteActivity` function (around line 775):

```ts
  const handleDeleteActivity = (activityId: string) => {
```

Add a new function directly above it:

```ts
  const scrollToActivity = (activityId: string) => {
    const node = activityListItemRefs.current.get(activityId)
    node?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const handleDeleteActivity = (activityId: string) => {
```

- [ ] **Step 3: Wire the ref callback onto the main list `<li>`**

Find the main list `<li>` opening tag (around line 1385):

```tsx
                return (
                  <li
                    key={activity.activity_id}
                    onDragOver={handleDragOver(activity.activity_id)}
                    onDragEnter={handleDragOver(activity.activity_id)}
                    onDragLeave={handleDragLeave(activity.activity_id)}
                    onDrop={handleDrop(activity.activity_id)}
                    className={[
```

Add a `ref` callback prop right after `key`:

```tsx
                return (
                  <li
                    key={activity.activity_id}
                    ref={(node) => {
                      if (node) {
                        activityListItemRefs.current.set(activity.activity_id, node)
                      } else {
                        activityListItemRefs.current.delete(activity.activity_id)
                      }
                    }}
                    onDragOver={handleDragOver(activity.activity_id)}
                    onDragEnter={handleDragOver(activity.activity_id)}
                    onDragLeave={handleDragLeave(activity.activity_id)}
                    onDrop={handleDrop(activity.activity_id)}
                    className={[
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm lint`
Expected: no new errors related to `lesson-activities-manager.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/lessons/lesson-activities-manager.tsx
git commit -m "feat: add scroll-to-activity ref map for activities sidebar"
```

---

### Task 2: Render the sticky sidebar with reorder, delete, and scroll-to-click

**Files:**
- Modify: `src/components/lessons/lesson-activities-manager.tsx`

- [ ] **Step 1: Wrap "Scheduled Activities" section content in a two-column layout and add the sidebar**

Find the "Scheduled Activities" section (around line 1301-1306):

```tsx
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Scheduled Activities</h3>
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activities have been added yet.</p>
          ) : (
            <ul className="space-y-3">
              {activities.map((activity) => {
```

Replace it with:

```tsx
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Scheduled Activities</h3>
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activities have been added yet.</p>
          ) : (
          <div className="flex gap-4">
            <aside className="sticky top-4 hidden max-h-[calc(100vh-2rem)] w-60 shrink-0 self-start overflow-y-auto md:block">
              <ul className="space-y-1">
                {activities.map((activity) => {
                  const sidebarIsDragging = draggingId === activity.activity_id
                  const sidebarIsDragOver = dragOverId === activity.activity_id
                  return (
                    <li
                      key={activity.activity_id}
                      onDragOver={handleDragOver(activity.activity_id)}
                      onDragEnter={handleDragOver(activity.activity_id)}
                      onDragLeave={handleDragLeave(activity.activity_id)}
                      onDrop={handleDrop(activity.activity_id)}
                      className={[
                        "flex items-center gap-1 rounded-md border border-transparent px-1 py-1 transition",
                        sidebarIsDragging ? "opacity-70" : "",
                        sidebarIsDragOver ? "border-primary bg-primary/5" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <button
                        type="button"
                        aria-label="Drag to reorder activity"
                        className="cursor-grab text-muted-foreground transition hover:text-foreground"
                        draggable
                        onDragStart={handleDragStart(activity.activity_id)}
                        onDragEnd={handleDragEnd}
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => scrollToActivity(activity.activity_id)}
                        className="flex-1 truncate text-left text-xs text-foreground hover:underline"
                        title={activity.title}
                      >
                        {activity.title}
                      </button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => handleDeleteActivity(activity.activity_id)}
                        disabled={isBusy}
                        aria-label="Delete activity"
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </li>
                  )
                })}
                {draggingId ? (
                  <li
                    key="activity-sidebar-dropzone-end"
                    onDragOver={handleDragOver(END_DROP_ID)}
                    onDragEnter={handleDragOver(END_DROP_ID)}
                    onDragLeave={handleDragLeave(END_DROP_ID)}
                    onDrop={handleDrop(END_DROP_ID)}
                    className={[
                      "h-6 rounded-md border-2 border-dashed border-border transition",
                      dragOverId === END_DROP_ID ? "border-primary bg-primary/5" : "border-transparent",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                ) : null}
              </ul>
            </aside>
            <ul className="flex-1 space-y-3">
              {activities.map((activity) => {
```

Note: this introduces a second, earlier reference to `END_DROP_ID` than the main list's own end-dropzone — that constant is declared once via `const END_DROP_ID = "__end__"` near `handleDrop` (around line 1137), well before this render code runs, so it's already in scope. No need to move or redeclare it.

- [ ] **Step 2: Close the new wrapping `<div>` where the main `<ul>` currently closes**

Find the end of the main list (around line 1497-1520, right after the main `<li>` closes and after the existing end-dropzone `<li>`):

```tsx
                </li>
              )
              })}
              {draggingId ? (
                <li
                key="activity-dropzone-end"
                onDragOver={handleDragOver(END_DROP_ID)}
                onDragEnter={handleDragOver(END_DROP_ID)}
                onDragLeave={handleDragLeave(END_DROP_ID)}
                onDrop={handleDrop(END_DROP_ID)}
                className={[
                  "h-12 rounded-md border-2 border-dashed border-border transition",
                  dragOverId === END_DROP_ID ? "border-primary bg-primary/5" : "border-transparent",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Drop here to move to the end
                </div>
              </li>
              ) : null}
            </ul>
          )}
        </section>
```

Replace the closing `</ul>\n          )}` with `</ul>\n          </div>\n          )}` so the new wrapper div is closed — full replacement:

```tsx
                </li>
              )
              })}
              {draggingId ? (
                <li
                key="activity-dropzone-end"
                onDragOver={handleDragOver(END_DROP_ID)}
                onDragEnter={handleDragOver(END_DROP_ID)}
                onDragLeave={handleDragLeave(END_DROP_ID)}
                onDrop={handleDrop(END_DROP_ID)}
                className={[
                  "h-12 rounded-md border-2 border-dashed border-border transition",
                  dragOverId === END_DROP_ID ? "border-primary bg-primary/5" : "border-transparent",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Drop here to move to the end
                </div>
              </li>
              ) : null}
            </ul>
          </div>
          )}
        </section>
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm lint`
Expected: no new errors related to `lesson-activities-manager.tsx`.

Run: `pnpm build`
Expected: build succeeds (no TypeScript errors).

- [ ] **Step 4: Manual verification in the browser**

Run: `pnpm dev`, open a lesson detail page with 3+ activities.

Confirm:
- A sidebar with activity titles appears to the left of the activity cards (on desktop widths — it's hidden below the `md` breakpoint via `hidden md:block`, matching the rest of the panel's responsive treatment).
- Scrolling the page keeps the sidebar pinned near the top (`sticky`).
- Dragging a sidebar row reorders both the sidebar and the main list, and persists (toast "Activity order update queued" appears, refresh shows new order).
- Dragging a main-list row also updates the sidebar order.
- Clicking a sidebar title smooth-scrolls the main list to that activity's card.
- Clicking the sidebar delete (trash) icon removes the activity from both lists and shows the "Activity deleted" toast.

- [ ] **Step 5: Commit**

```bash
git add src/components/lessons/lesson-activities-manager.tsx
git commit -m "feat: add sticky sidebar for reordering, deleting, and jumping to lesson activities"
```

---

## Self-review notes (completed during planning)

- **Spec coverage:** sticky sidebar (Task 2), reorder via drag-and-drop reusing existing handlers (Task 2), delete reusing `handleDeleteActivity` with no confirmation (Task 2), scroll-to-activity on title click (Task 1 + 2), main list controls untouched (verified — no edits to existing drag handle/delete button JSX, only added a `ref` prop), empty state hides sidebar (handled by keeping the `activities.length === 0` ternary unchanged, sidebar only renders in the `else` branch).
- **Placeholder scan:** none — every step shows exact before/after code.
- **Type consistency:** sidebar reuses `handleDragStart`, `handleDragOver`, `handleDragLeave`, `handleDrop`, `handleDragEnd`, `handleDeleteActivity`, `draggingId`, `dragOverId`, `END_DROP_ID`, `isBusy`, `Button`, `GripVertical`, `Trash2` — all already defined/imported earlier in the same file, no new identifiers introduced besides `activityListItemRefs` and `scrollToActivity` (Task 1), which Task 2 consumes with matching names.
