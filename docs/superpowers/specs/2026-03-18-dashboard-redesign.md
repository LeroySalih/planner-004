# Dashboard Redesign — 4-Quarter Card Layout

**Date:** 2026-03-18
**Branch:** update-dashboard
**Status:** Approved

## Overview

Redesign the teacher dashboard from a 3-panel column layout to a 2×2 quad-grid layout. Add a new "Recent Submissions" panel and change the Flagged panel to group by pupil rather than listing individual submissions.

## Layout

```
┌─────────────────────┬─────────────────────┐
│  Recent Submissions │   Needs Review      │
│  (top-left)         │   (top-right)       │
├─────────────────────┼─────────────────────┤
│  Flagged by Pupil   │   Mentions          │
│  (bottom-left)      │   (bottom-right)    │
└─────────────────────┴─────────────────────┘
```

Each quadrant has a fixed `max-height` with vertical scroll. Items within each quadrant are displayed as compact cards using `flex-wrap`, so multiple cards appear per row.

---

## Changes

### 1. Flagged Panel — Group by Pupil

**Current behaviour:** Lists each flagged submission individually.

**New behaviour:** Groups flagged submissions by pupil client-side. Renders top 5 pupils ranked by flag count.

- No `LIMIT` in SQL — all flagged submissions are fetched, then reduced in the component so the grouping is correct before slicing.
- Each card: pupil name · group/subject · flag count badge.
- Empty state: "No flagged submissions."
- Error state: inline error message matching existing panel pattern.

**Data:** Existing `readFlaggedSubmissionsAction` returns sufficient fields (`pupilName`, `groupName`, `groupId`, `lessonId`). No SQL changes needed.

**Status bar:** `DashboardClient` continues to show the raw flagged submission count (not pupil count) — no change.

---

### 2. Recent Submissions Panel — New

New panel in the **top-left** quadrant. Shows lessons that received at least one submission within the selected time window.

**Time filter:** 1h · 24h · 48h · 72h. Default: 24h. State is local React state inside the component — no URL persistence.

**Component architecture:** `RecentSubmissionsPanel` is a **client component** (`"use client"`). It holds the selected `hours` in state and calls `readRecentSubmissionsAction(hours)` via `useTransition` when the filter changes. Initial fetch on mount. The panel is wrapped in `<Suspense>` at the page level for the initial load skeleton.

**Each card shows:** lesson title · group name · submission count badge.

**Empty state:** "No submissions in the last {n}h."
**Error state:** inline error message.

**Status bar:** Recent Submissions count is **not** shown in `DashboardClient`'s live status bar. No changes to `DashboardClient`.

**Server action:** Add `readRecentSubmissionsAction` to `src/lib/server-actions/dashboard.ts`:

```typescript
// Input
const RecentSubmissionsInputSchema = z.object({
  hours: z.union([z.literal(1), z.literal(24), z.literal(48), z.literal(72)]),
})

// Item
const RecentSubmissionsItemSchema = z.object({
  lessonId: z.string(),
  lessonTitle: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  submissionCount: z.number(),
})

export type RecentSubmissionsItem = z.infer<typeof RecentSubmissionsItemSchema>
```

**SQL** (teacher-scoped, safe interval parameterisation):

```sql
SELECT
  l.lesson_id,
  l.title                                 AS lesson_title,
  g.group_id,
  g.subject                               AS group_name,
  COUNT(DISTINCT s.submission_id)::int    AS submission_count
FROM submissions         s
JOIN activities          a   ON a.activity_id  = s.activity_id
JOIN lessons             l   ON l.lesson_id    = a.lesson_id
JOIN lesson_assignments  la  ON la.lesson_id   = l.lesson_id
JOIN groups              g   ON g.group_id     = la.group_id
JOIN group_membership    gm  ON gm.group_id    = g.group_id
                            AND gm.user_id     = s.user_id
WHERE s.submitted_at >= NOW() - ($1 * interval '1 hour')
GROUP BY l.lesson_id, l.title, g.group_id, g.subject
ORDER BY submission_count DESC
```

- `$1` is the numeric hours value (1, 24, 48, or 72).
- The `group_membership` join scopes results to the authenticated teacher's groups.

---

### 3. Layout Change

**Current:** `grid-template-columns: 2fr 1fr` with Flagged/Mentions stacked in the right column.

**New:** `grid-template-columns: 1fr 1fr` equal quadrants with `grid-template-rows: auto auto`.

**Card grid inside each panel:** `display: flex; flex-wrap: wrap; gap: 6px`. Cards use `flex: 0 1 auto`.

Each panel: `max-height` set (e.g. `260px`) with `overflow-y: auto`.

---

## Components Affected

| File | Change |
|------|--------|
| `src/app/page.tsx` | Restructure to 2×2 grid; add `<RecentSubmissionsPanel />` in Suspense |
| `src/components/teacher-dashboard/flagged-panel.tsx` | Group by pupil client-side, top 5, render as cards |
| `src/components/teacher-dashboard/marking-queue-panel.tsx` | Render as cards instead of rows |
| `src/components/teacher-dashboard/mentions-panel.tsx` | Render as cards instead of rows |
| `src/components/teacher-dashboard/recent-submissions-panel.tsx` | New client component with time filter + card grid |
| `src/lib/server-actions/dashboard.ts` | Add `readRecentSubmissionsAction` with Zod schemas and exported type |
| `src/lib/server-updates.ts` | Re-export `readRecentSubmissionsAction` and `RecentSubmissionsItem` |

`src/components/teacher-dashboard/dashboard-client.tsx` — **no changes needed**.

---

## Out of Scope

- Persisting time filter selection across page loads
- SSE live-updates for recent submission count
- Any changes to marking, flagging, or mention logic
