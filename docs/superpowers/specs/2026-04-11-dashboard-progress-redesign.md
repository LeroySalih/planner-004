# Dashboard Progress Redesign

**Date:** 2026-04-11
**Status:** Design

## Summary

Replace the existing teacher dashboard (4-panel 2x2 grid showing recent submissions, marking queue, flagged, mentions) with a new **Progress tab** that shows a card per class. Each card displays a stacked bar chart showing the percentage of pupils in three score bands. Clicking a card navigates to the existing unit-progress-reports detail page.

## Requirements

### Progress Tab (the only tab for now)

1. **Class cards grid** — one card per group the teacher belongs to
2. **Each card shows:**
   - Group ID (e.g. "25-11-DT")
   - Subject name (e.g. "Design Technology")
   - Total pupil count
   - A horizontal stacked bar chart split into three colored sections:
     - **Green (≥70%)** — pupils whose overall average score is 70% or above
     - **Amber (40–69%)** — pupils scoring between 40% and 69%
     - **Red (<40%)** — pupils scoring below 40%
   - Percentage labels on each bar section
   - Small legend below the bar showing actual pupil counts per band
3. **Filter text box** — at the top of the page, filters cards by group ID or subject name (client-side, instant)
4. **Card click** — navigates to `/unit-progress-reports/[groupId]`
5. **Responsive grid** — `auto-fill, minmax(280px, 1fr)` so cards reflow on different screen sizes

### Score Calculation

Each pupil's "overall average score" is computed across all their latest submissions for scorable activities in active lessons assigned to the class. This matches the existing logic in `unit-progress-reports`:

- Use `compute_submission_base_score(body, activity_type)` for individual submission scores
- Take `DISTINCT ON (activity_id, user_id)` ordered by `submitted_at DESC` to get the latest submission per activity per pupil
- Average across all scorable activities in all active lessons assigned to the group
- Scorable activity types: `multiple-choice-question`, `short-text-question`, `upload-file` (matching existing `unit-progress-reports/actions.ts`)

### Thresholds

- Green: score >= 0.70
- Amber: score >= 0.40 AND score < 0.70
- Red: score < 0.40

These match the existing thresholds used in `unit-progress-reports` components.

## Architecture

### Approach: New SQL function

Create a PostgreSQL function `dashboard_class_progress_summary(p_teacher_id text)` that:

1. Finds all groups where the teacher is a member
2. For each group, finds all pupils (non-teacher members)
3. For each pupil, computes their overall average score across all scorable activities in active lessons assigned to that group
4. Buckets each pupil into green/amber/red based on their average
5. Returns one row per group: `group_id, group_subject, total_pupils, green_count, amber_count, red_count`

This keeps all scoring logic in SQL alongside the existing `compute_submission_base_score` function and delivers the dashboard data in a single query.

### New SQL Migration

File: `src/migrations/072-dashboard-progress-summary.sql`

```sql
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

### New Server Action

File: `src/lib/server-actions/dashboard.ts` (extend existing)

```typescript
export async function readDashboardProgressAction() {
  const profile = await requireRole("teacher")
  return withTelemetry("readDashboardProgressAction", {}, async () => {
    const { rows } = await query(
      `SELECT * FROM dashboard_class_progress_summary($1)`,
      [profile.userId]
    )
    return { data: rows, error: null }
  })
}
```

Export from `src/lib/server-updates.ts`.

### New Page

Replace `src/app/page.tsx` with the new dashboard:

- Server component fetches data via `readDashboardProgressAction()`
- Renders a client component `ProgressDashboard` that handles:
  - Filter text box (client-side state)
  - Card grid rendering with stacked bar charts
  - Click handler navigating to `/unit-progress-reports/[groupId]`
- Uses existing Tailwind classes and dark mode tokens
- No external charting library — the stacked bar is pure CSS flexbox (matching the mockup)

### Files Changed

| File | Action |
|------|--------|
| `src/migrations/072-dashboard-progress-summary.sql` | Create — new SQL function |
| `src/lib/server-actions/dashboard.ts` | Modify — add `readDashboardProgressAction` |
| `src/lib/server-updates.ts` | Modify — export new action |
| `src/app/page.tsx` | Rewrite — new Progress dashboard |
| `src/components/teacher-dashboard/progress-dashboard.tsx` | Create — client component with filter + card grid |
| `src/components/teacher-dashboard/progress-card.tsx` | Create — individual card with stacked bar |

### Files Removed

The following components are no longer used by the dashboard page and should be deleted:

| File | Reason |
|------|--------|
| `src/components/teacher-dashboard/dashboard-client.tsx` | SSE-based 4-panel wrapper, replaced |
| `src/components/teacher-dashboard/marking-queue-panel.tsx` | Old panel |
| `src/components/teacher-dashboard/flagged-panel.tsx` | Old panel |
| `src/components/teacher-dashboard/recent-submissions-panel.tsx` | Old panel |
| `src/components/teacher-dashboard/mentions-panel.tsx` | Old panel |
| `src/components/teacher-dashboard/class-sidebar.tsx` | Old sidebar filter |
| `src/components/teacher-dashboard/mark-all-button.tsx` | Old marking action |

**Note:** The old server actions (`readMarkingQueueAction`, `readFlaggedSubmissionsAction`, etc.) remain in `dashboard.ts` — they may be needed by future tabs or other pages.

## Design Decisions

1. **No time-period filter (24h/1w/1m) in v1** — The original request mentioned these but the approved design focuses on current overall scores. Time-period comparison can be added as a future enhancement.
2. **Tab infrastructure** — The page renders a tab bar with a single "Progress" tab. This makes it trivial to add more tabs later without restructuring.
3. **No charting library** — The stacked bar is simple enough to implement with CSS flexbox, avoiding a dependency.
4. **Pupils with no submissions score 0** — A pupil with no submissions is bucketed into the red band. This matches the existing `unit-progress-reports` behavior where `COALESCE(score, 0)` is used.
