# Dashboard Progress Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the teacher dashboard with a Progress tab showing class cards with stacked score-band bar charts.

**Architecture:** New SQL function `dashboard_class_progress_summary` computes per-class pupil score bands in a single query. A new server action calls it. The page renders a client component with a filter text box and a responsive card grid. Each card has a CSS flexbox stacked bar and links to the existing unit-progress-reports page.

**Tech Stack:** PostgreSQL function, Next.js 15 server action, React 19 client component, Tailwind CSS v4

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/migrations/072-dashboard-progress-summary.sql` | Create | SQL function returning score band counts per class |
| `src/lib/server-actions/dashboard.ts` | Modify | Add `readDashboardProgressAction` |
| `src/lib/server-updates.ts` | Modify | Export new action |
| `src/components/teacher-dashboard/progress-card.tsx` | Create | Single class card with stacked bar chart |
| `src/components/teacher-dashboard/progress-dashboard.tsx` | Create | Client component: filter + card grid |
| `src/app/page.tsx` | Rewrite | New Progress dashboard page |
| `src/components/teacher-dashboard/dashboard-client.tsx` | Delete | Old SSE wrapper |
| `src/components/teacher-dashboard/marking-queue-panel.tsx` | Delete | Old panel |
| `src/components/teacher-dashboard/flagged-panel.tsx` | Delete | Old panel |
| `src/components/teacher-dashboard/recent-submissions-panel.tsx` | Delete | Old panel |
| `src/components/teacher-dashboard/mentions-panel.tsx` | Delete | Old panel |
| `src/components/teacher-dashboard/class-sidebar.tsx` | Delete | Old sidebar |
| `src/components/teacher-dashboard/mark-all-button.tsx` | Delete | Old marking button |

---

### Task 1: Create the SQL migration

**Files:**
- Create: `src/migrations/072-dashboard-progress-summary.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 072-dashboard-progress-summary.sql
-- Returns per-class pupil counts in three score bands (green ≥70%, amber 40-69%, red <40%)
-- for all classes where the given teacher is a member.

CREATE OR REPLACE FUNCTION dashboard_class_progress_summary(p_teacher_id text)
RETURNS TABLE (
  group_id text,
  group_subject text,
  total_pupils bigint,
  green_count bigint,
  amber_count bigint,
  red_count bigint
) AS $$
  WITH teacher_groups AS (
    SELECT gm.group_id
    FROM group_membership gm
    JOIN groups g ON g.group_id = gm.group_id AND coalesce(g.active, true) = true
    WHERE gm.user_id = p_teacher_id
      AND gm.role = 'teacher'
  ),
  pupil_members AS (
    SELECT gm.group_id, gm.user_id AS pupil_id
    FROM group_membership gm
    JOIN teacher_groups tg ON tg.group_id = gm.group_id
    WHERE gm.role = 'pupil'
  ),
  latest_submissions AS (
    SELECT DISTINCT ON (s.activity_id, s.user_id)
      s.activity_id, s.user_id, s.body, a.type AS activity_type, la.group_id
    FROM submissions s
    JOIN activities a ON a.activity_id = s.activity_id
      AND lower(trim(coalesce(a.type, ''))) = ANY(ARRAY[
        'multiple-choice-question','short-text-question','upload-file'
      ])
      AND coalesce(a.is_active, true) = true
    JOIN lessons l ON l.lesson_id = a.lesson_id
      AND coalesce(l.active, true) = true
    JOIN lesson_assignments la ON la.lesson_id = l.lesson_id
    JOIN teacher_groups tg ON tg.group_id = la.group_id
    JOIN pupil_members pm ON pm.group_id = la.group_id AND pm.pupil_id = s.user_id
    WHERE s.submitted_at IS NOT NULL
    ORDER BY s.activity_id, s.user_id, s.submitted_at DESC NULLS LAST, s.submission_id DESC
  ),
  pupil_averages AS (
    SELECT
      ls.group_id,
      ls.user_id AS pupil_id,
      AVG(coalesce(compute_submission_base_score(ls.body::jsonb, ls.activity_type), 0)) AS avg_score
    FROM latest_submissions ls
    GROUP BY ls.group_id, ls.user_id
  ),
  all_pupils AS (
    SELECT
      pm.group_id,
      pm.pupil_id,
      coalesce(pa.avg_score, 0) AS avg_score
    FROM pupil_members pm
    LEFT JOIN pupil_averages pa ON pa.group_id = pm.group_id AND pa.pupil_id = pm.pupil_id
  )
  SELECT
    g.group_id,
    g.subject AS group_subject,
    count(*) AS total_pupils,
    count(*) FILTER (WHERE ap.avg_score >= 0.70) AS green_count,
    count(*) FILTER (WHERE ap.avg_score >= 0.40 AND ap.avg_score < 0.70) AS amber_count,
    count(*) FILTER (WHERE ap.avg_score < 0.40) AS red_count
  FROM all_pupils ap
  JOIN groups g ON g.group_id = ap.group_id
  GROUP BY g.group_id, g.subject
  ORDER BY g.group_id;
$$ LANGUAGE sql STABLE;
```

- [ ] **Step 2: Run migration against dev database**

Run: `psql "$DATABASE_URL" -f src/migrations/072-dashboard-progress-summary.sql`
Expected: `CREATE FUNCTION`

- [ ] **Step 3: Verify function works**

Run: `psql "$DATABASE_URL" -c "SELECT * FROM dashboard_class_progress_summary('<a-teacher-user-id>') LIMIT 5;"`

To find a teacher user id, run: `psql "$DATABASE_URL" -c "SELECT user_id FROM user_roles WHERE role_id = 'teacher' LIMIT 1;"`

Expected: Rows with `group_id`, `group_subject`, `total_pupils`, `green_count`, `amber_count`, `red_count`. The three counts should sum to `total_pupils` for each row.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/072-dashboard-progress-summary.sql
git commit -m "feat: add dashboard_class_progress_summary SQL function"
```

---

### Task 2: Add the server action

**Files:**
- Modify: `src/lib/server-actions/dashboard.ts` (append after line 436)
- Modify: `src/lib/server-updates.ts` (add export)

- [ ] **Step 1: Add Zod schema and action to dashboard.ts**

Append the following after the last function in `src/lib/server-actions/dashboard.ts`:

```typescript
// ── Dashboard Progress ──────────────────────────────────────────────────────

const DashboardProgressItemSchema = z.object({
  groupId: z.string(),
  groupSubject: z.string(),
  totalPupils: z.number(),
  greenCount: z.number(),
  amberCount: z.number(),
  redCount: z.number(),
})

const DashboardProgressResultSchema = z.object({
  data: DashboardProgressItemSchema.array().nullable(),
  error: z.string().nullable(),
})

export type DashboardProgressItem = z.infer<typeof DashboardProgressItemSchema>

export async function readDashboardProgressAction() {
  const { userId: teacherUserId } = await requireTeacherProfile()
  const authEndTime = performance.now()

  return withTelemetry(
    { routeTag: "dashboard", functionName: "readDashboardProgressAction", params: {}, authEndTime },
    async () => {
      try {
        const { rows } = await query<{
          group_id: string
          group_subject: string
          total_pupils: string
          green_count: string
          amber_count: string
          red_count: string
        }>(
          `SELECT * FROM dashboard_class_progress_summary($1)`,
          [teacherUserId],
        )

        const data = (rows ?? []).map((row) => ({
          groupId: row.group_id,
          groupSubject: row.group_subject,
          totalPupils: Number(row.total_pupils),
          greenCount: Number(row.green_count),
          amberCount: Number(row.amber_count),
          redCount: Number(row.red_count),
        }))

        return DashboardProgressResultSchema.parse({ data, error: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load dashboard progress."
        console.error("[dashboard] readDashboardProgressAction failed", error)
        return DashboardProgressResultSchema.parse({ data: null, error: message })
      }
    },
  )
}
```

- [ ] **Step 2: Export from server-updates.ts**

In `src/lib/server-updates.ts`, find the existing dashboard export block:

```typescript
export {
  readMarkingQueueAction,
  readFlaggedSubmissionsAction,
  readMentionsAction,
  readRecentSubmissionsAction,
  markAllUnmarkedForLessonAction,
  type MarkingQueueItem,
  type FlaggedItem,
  type MentionItem,
  type RecentSubmissionsItem,
} from "./server-actions/dashboard"
```

Replace it with:

```typescript
export {
  readMarkingQueueAction,
  readFlaggedSubmissionsAction,
  readMentionsAction,
  readRecentSubmissionsAction,
  markAllUnmarkedForLessonAction,
  readDashboardProgressAction,
  type DashboardProgressItem,
  type MarkingQueueItem,
  type FlaggedItem,
  type MentionItem,
  type RecentSubmissionsItem,
} from "./server-actions/dashboard"
```

- [ ] **Step 3: Verify build compiles**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors related to dashboard

- [ ] **Step 4: Commit**

```bash
git add src/lib/server-actions/dashboard.ts src/lib/server-updates.ts
git commit -m "feat: add readDashboardProgressAction server action"
```

---

### Task 3: Create the ProgressCard component

**Files:**
- Create: `src/components/teacher-dashboard/progress-card.tsx`

- [ ] **Step 1: Create progress-card.tsx**

```tsx
"use client"

import { useRouter } from "next/navigation"
import type { DashboardProgressItem } from "@/lib/server-updates"

export function ProgressCard({ item }: { item: DashboardProgressItem }) {
  const router = useRouter()
  const { groupId, groupSubject, totalPupils, greenCount, amberCount, redCount } = item

  const total = greenCount + amberCount + redCount
  const greenPct = total > 0 ? Math.round((greenCount / total) * 100) : 0
  const amberPct = total > 0 ? Math.round((amberCount / total) * 100) : 0
  const redPct = total > 0 ? 100 - greenPct - amberPct : 0

  return (
    <button
      type="button"
      onClick={() => router.push(`/unit-progress-reports/${groupId}`)}
      className="w-full rounded-lg border border-border bg-card p-5 text-left transition-shadow hover:shadow-md"
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{groupId}</div>
          <div className="text-xs text-muted-foreground">{groupSubject}</div>
        </div>
        <div className="text-xs text-muted-foreground">{totalPupils} pupils</div>
      </div>

      {/* Stacked bar */}
      <div className="mb-2 flex h-7 overflow-hidden rounded-md">
        {greenPct > 0 && (
          <div
            className="flex items-center justify-center bg-green-500 text-xs font-semibold text-white"
            style={{ width: `${greenPct}%` }}
          >
            {greenPct}%
          </div>
        )}
        {amberPct > 0 && (
          <div
            className="flex items-center justify-center bg-amber-500 text-xs font-semibold text-white"
            style={{ width: `${amberPct}%` }}
          >
            {amberPct}%
          </div>
        )}
        {redPct > 0 && (
          <div
            className="flex items-center justify-center bg-red-500 text-xs font-semibold text-white"
            style={{ width: `${redPct}%` }}
          >
            {redPct}%
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-green-500" />
          {greenCount} ≥70%
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-500" />
          {amberCount} 40–69%
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-500" />
          {redCount} &lt;40%
        </span>
      </div>
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-dashboard/progress-card.tsx
git commit -m "feat: add ProgressCard component with stacked bar chart"
```

---

### Task 4: Create the ProgressDashboard component

**Files:**
- Create: `src/components/teacher-dashboard/progress-dashboard.tsx`

- [ ] **Step 1: Create progress-dashboard.tsx**

```tsx
"use client"

import { useState } from "react"
import type { DashboardProgressItem } from "@/lib/server-updates"
import { ProgressCard } from "@/components/teacher-dashboard/progress-card"

export function ProgressDashboard({ items }: { items: DashboardProgressItem[] }) {
  const [filter, setFilter] = useState("")

  const filtered = items.filter((item) => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      item.groupId.toLowerCase().includes(q) ||
      item.groupSubject.toLowerCase().includes(q)
    )
  })

  return (
    <div>
      {/* Filter bar */}
      <div className="px-6 pt-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder='Filter classes… e.g. "9A" or "Computer Science"'
          className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 p-6">
        {filtered.map((item) => (
          <ProgressCard key={item.groupId} item={item} />
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? "No classes found."
              : "No classes match your filter."}
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-dashboard/progress-dashboard.tsx
git commit -m "feat: add ProgressDashboard component with filter and card grid"
```

---

### Task 5: Rewrite the dashboard page

**Files:**
- Rewrite: `src/app/page.tsx`

- [ ] **Step 1: Replace src/app/page.tsx with the new dashboard**

```tsx
export const dynamic = "force-dynamic"

import { requireTeacherProfile } from "@/lib/auth"
import { readDashboardProgressAction } from "@/lib/server-updates"
import { ProgressDashboard } from "@/components/teacher-dashboard/progress-dashboard"

export default async function TeacherDashboardPage() {
  const profile = await requireTeacherProfile()
  const result = await readDashboardProgressAction()
  const items = result.data ?? []

  const displayName =
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.email || "Teacher"

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex items-center justify-between border-b border-border bg-card px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">{displayName}</span>
          <span className="text-xs text-muted-foreground">Teacher Dashboard</span>
        </div>
        <div className="flex gap-2">
          <div className="border-b-2 border-primary px-4 py-1.5 text-xs font-semibold text-primary">
            Progress
          </div>
        </div>
      </div>

      <ProgressDashboard items={items} />
    </main>
  )
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Verify visually in the browser**

Open http://localhost:3000 in the browser. You should see:
- Teacher name and "Teacher Dashboard" header
- A "Progress" tab indicator
- A filter text box
- A grid of class cards with stacked green/amber/red bars
- Clicking a card navigates to `/unit-progress-reports/[groupId]`

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: rewrite dashboard page with Progress tab and class cards"
```

---

### Task 6: Delete old dashboard components

**Files:**
- Delete: `src/components/teacher-dashboard/dashboard-client.tsx`
- Delete: `src/components/teacher-dashboard/marking-queue-panel.tsx`
- Delete: `src/components/teacher-dashboard/flagged-panel.tsx`
- Delete: `src/components/teacher-dashboard/recent-submissions-panel.tsx`
- Delete: `src/components/teacher-dashboard/mentions-panel.tsx`
- Delete: `src/components/teacher-dashboard/class-sidebar.tsx`
- Delete: `src/components/teacher-dashboard/mark-all-button.tsx`

- [ ] **Step 1: Check no other files import these components**

Run:
```bash
cd /Users/leroysalih/nodejs/planner-004
grep -r "dashboard-client\|marking-queue-panel\|flagged-panel\|recent-submissions-panel\|mentions-panel\|class-sidebar\|mark-all-button" src/ --include="*.ts" --include="*.tsx" -l
```

Expected: No files listed (the old `page.tsx` was already rewritten in Task 5). If any files still import these, update them first.

- [ ] **Step 2: Delete old components**

```bash
rm src/components/teacher-dashboard/dashboard-client.tsx
rm src/components/teacher-dashboard/marking-queue-panel.tsx
rm src/components/teacher-dashboard/flagged-panel.tsx
rm src/components/teacher-dashboard/recent-submissions-panel.tsx
rm src/components/teacher-dashboard/mentions-panel.tsx
rm src/components/teacher-dashboard/class-sidebar.tsx
rm src/components/teacher-dashboard/mark-all-button.tsx
```

- [ ] **Step 3: Verify build still compiles**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add -u src/components/teacher-dashboard/
git commit -m "chore: remove old dashboard panel components"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run lint**

Run: `cd /Users/leroysalih/nodejs/planner-004 && pnpm lint 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 2: Run build**

Run: `cd /Users/leroysalih/nodejs/planner-004 && pnpm build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 3: Manual smoke test**

Open http://localhost:3000 and verify:
1. Dashboard loads with class cards
2. Filter text box narrows the cards when typing
3. Clicking a card navigates to `/unit-progress-reports/[groupId]`
4. Dark mode toggle works (cards and bar colors are visible)
5. Page is responsive — cards reflow at narrow widths
