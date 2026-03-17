# Submission Count Statistics Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the number of times a pupil has submitted each scorable activity (as a pill next to the score), and display the average submissions per activity per lesson on the pupil-units detail page.

**Architecture:** Two independent features share the same data source (`activity_submission_events`). Feature 1 queries counts per-activity within the existing lesson detail server component and passes them as a new prop to `ActivityProgressPanel`. Feature 2 adds a single aggregate query to the existing `readPupilUnitsBootstrapAction`, extends the Zod schema and TypeScript type, and renders a pill in `PupilUnitsView`.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript, PostgreSQL via `pg`, Zod, Tailwind CSS v4.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/activity-progress-panel.tsx` | Modify | Add `submissionCount?: number` prop; render count pill |
| `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx` | Modify | Bulk query `activity_submission_events` for lesson; pass count to `ActivityProgressPanel` |
| `src/lib/server-actions/pupil-units.ts` | Modify | Add avg-submissions-per-lesson query; add `avgSubmissionsPerActivity` to Zod schema |
| `src/lib/pupil-units-data.ts` | Modify | Add `avgSubmissionsPerActivity: number \| null` to `PupilUnitLesson` type |
| `src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx` | Modify | Render avg submissions pill on each lesson card |

---

## Task 1: Submission count pill on `ActivityProgressPanel`

### Step 1.1 — Add `submissionCount` prop and pill to `ActivityProgressPanel`

**File:** `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/activity-progress-panel.tsx`

- [ ] Add `submissionCount?: number` to the `ActivityProgressPanelProps` type
- [ ] Destructure it in the function signature
- [ ] Render a pill in the header row, immediately after the score span, only when `submissionCount` is defined and `>= 1`:

```tsx
type ActivityProgressPanelProps = {
  assignmentIds: string[]
  lessonId: string
  initialVisible: boolean
  show: boolean
  scoreLabel: string
  feedbackText: string | null | undefined
  modelAnswer: string | null | undefined
  isMarked: boolean
  isPendingMarking?: boolean
  lockedMessage?: string
  flagSlot?: ReactNode
  submissionCount?: number  // ← ADD
}

export function ActivityProgressPanel({
  // ...existing props...
  submissionCount,           // ← ADD
}: ActivityProgressPanelProps) {
  // ...existing body...

  return (
    <div className="mt-4 rounded-lg border border-border bg-background/80 p-4 text-sm shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/5 text-[11px] font-semibold uppercase tracking-wide text-primary"
          >
            Your progress
          </Badge>
          <span className="text-xs text-muted-foreground">
            {isPendingMarking ? "Awaiting marking" : showResults ? "Feedback released" : "Feedback not yet released"}
          </span>
        </div>
        <div className="flex items-center gap-2">   {/* ← WRAP in div */}
          {typeof submissionCount === "number" && submissionCount >= 1 && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300">
              {submissionCount === 1 ? "1 attempt" : `${submissionCount} attempts`}
            </span>
          )}
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {showResults ? scoreLabel : isPendingMarking ? "Waiting for marking" : "In progress"}
          </span>
        </div>                                       {/* ← CLOSE div */}
      </div>
      {/* ...rest of component unchanged... */}
    </div>
  )
}
```

- [ ] Build the project to check for TypeScript errors: `pnpm build 2>&1 | head -40`

---

### Step 1.2 — Batch-query submission event counts in the lesson detail page

**File:** `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`

The page is a large server component. Add the query after the existing `activitySubmissionIdMap` block (around line 648) and before the `isPupilViewer` declaration (line 650). Add a single query that counts events per scorable activity for this lesson and pupil.

- [ ] Find the block starting with `// Unified map of activityId -> submissionId` (line ~634) and add the query **after** it:

```ts
// Submission event counts per activity for this pupil
const scorableActivityIds = activities
  .filter((a) => ["multiple-choice-question", "short-text-question", "text-question", "upload-url", "upload-file"].includes(a.type ?? ""))
  .map((a) => a.activity_id)

const submissionCountMap = new Map<string, number>()
if (scorableActivityIds.length > 0) {
  try {
    const { rows: submissionCountRows } = await query<{ activity_id: string; event_count: string }>(
      `
        SELECT activity_id, COUNT(*) as event_count
        FROM activity_submission_events
        WHERE lesson_id = $1
          AND pupil_id = $2
          AND activity_id = ANY($3::text[])
        GROUP BY activity_id
      `,
      [lesson.lesson_id, pupilId, scorableActivityIds],
    )
    for (const row of submissionCountRows) {
      submissionCountMap.set(row.activity_id, parseInt(row.event_count, 10))
    }
  } catch (err) {
    console.error("[lesson-page] Failed to load submission event counts:", err)
  }
}
```

Note: `query` is already imported from `@/lib/db` on this page.

- [ ] Build to verify: `pnpm build 2>&1 | head -40`

---

### Step 1.3 — Pass `submissionCount` to `ActivityProgressPanel`

**File:** `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`

Find the `<ActivityProgressPanel` JSX call(s) (line ~1113) and add the `submissionCount` prop:

```tsx
<ActivityProgressPanel
  assignmentIds={assignmentIds}
  lessonId={lesson.lesson_id}
  initialVisible={initialFeedbackVisible}
  show={showProgress && activity.type !== "short-text-question"}
  scoreLabel={formatScoreLabel(rawScore)}
  feedbackText={feedbackText}
  modelAnswer={modelAnswer}
  isMarked={typeof rawScore === "number"}
  isPendingMarking={rawScore === null}
  submissionCount={submissionCountMap.get(activity.activity_id)}  {/* ← ADD */}
/>
```

There may be multiple `<ActivityProgressPanel` call sites (lines ~868, ~883, ~897, ~922 also show `scoreLabel` usage — confirm whether these are also `ActivityProgressPanel` usages or just scoreLabel references in other elements). Pass the prop to every `<ActivityProgressPanel` invocation.

- [ ] Run `pnpm build 2>&1 | head -40` — expect clean build
- [ ] Start dev server and navigate to `/pupil-lessons/[any-pupil-id]/lessons/[any-lesson-id]`
- [ ] Verify that a scorable activity the pupil has submitted shows "1 attempt" or "N attempts"

- [ ] Commit:
```bash
git add src/app/pupil-lessons/\[pupilId\]/lessons/\[lessonId\]/activity-progress-panel.tsx \
        src/app/pupil-lessons/\[pupilId\]/lessons/\[lessonId\]/page.tsx
git commit -m "feat: show submission attempt count pill on activity progress panel"
```

---

## Task 2: Average submissions per activity per lesson on pupil-units page

These files are entirely independent from Task 1.

### Step 2.1 — Add avg submissions query to `readPupilUnitsBootstrapAction`

**File:** `src/lib/server-actions/pupil-units.ts`

The action fetches lesson data in two sequential batches. The second fetch (lessonScoresResult, lines 386–435) already has the exact same `lessonIds` and `normalizedPupilId` variables available. Add a third query in the same sequential block.

- [ ] Add the Zod schema field first. In the `SubjectUnitsSchema` definition, add `avgSubmissionsPerActivity` to the lesson schema inside `z.array(z.object({...}))` (around line 112):

```ts
resubmitCount: z.number().int().default(0),
avgSubmissionsPerActivity: z.number().nullable().default(null),  // ← ADD
```

- [ ] Add the query after `resubmitResult` (around line 451):

```ts
// Fetch average submission event count per scorable activity, per lesson
const avgSubmissionsResult = lessonIds.length === 0
  ? { rows: [] as { lesson_id: string; avg_submissions: string }[] }
  : await query<{ lesson_id: string; avg_submissions: string }>(
    `
      SELECT
        a.lesson_id,
        COALESCE(SUM(ase_counts.cnt), 0)::numeric / NULLIF(COUNT(a.activity_id), 0) AS avg_submissions
      FROM activities a
      LEFT JOIN (
        SELECT activity_id, COUNT(*) AS cnt
        FROM activity_submission_events
        WHERE pupil_id = $2
        GROUP BY activity_id
      ) ase_counts ON ase_counts.activity_id = a.activity_id
      WHERE a.lesson_id = ANY($1::text[])
        AND a.type = ANY($3::text[])
        AND coalesce(a.active, true) = true
      GROUP BY a.lesson_id
    `,
    [
      lessonIds,
      normalizedPupilId,
      ["multiple-choice-question", "short-text-question", "text-question", "upload-url", "upload-file"],
    ],
  );

const avgSubmissionsByLesson = new Map<string, number>()
for (const row of avgSubmissionsResult.rows) {
  const val = parseFloat(row.avg_submissions)
  if (!Number.isNaN(val)) {
    avgSubmissionsByLesson.set(row.lesson_id, Math.round(val * 10) / 10)
  }
}
```

- [ ] Wire it into the lesson object assembly (around line 666, inside `unitEntry.lessonsMap.set(...)`):

```ts
resubmitCount: resubmitByLesson.get(assignment.lesson_id) ?? 0,
avgSubmissionsPerActivity: avgSubmissionsByLesson.get(assignment.lesson_id) ?? null,  // ← ADD
```

- [ ] Build: `pnpm build 2>&1 | head -40`

---

### Step 2.2 — Add `avgSubmissionsPerActivity` to TypeScript type

**File:** `src/lib/pupil-units-data.ts`

The `PupilUnitLesson` type is the shape consumed by `PupilUnitsView`. It must mirror what the server action returns.

- [ ] Add the field to `PupilUnitLesson`:

```ts
export type PupilUnitLesson = {
  lessonId: string;
  lessonTitle: string;
  lessonOrder: number | null;
  startDate: string | null;
  groupId: string;
  subject: string | null;
  feedbackVisible: boolean;
  isEnrolled: boolean;
  locked: boolean;
  objectives: Array<{ id: string; title: string; orderIndex: number | null }>;
  displayImages: PupilUnitLessonMediaImage[];
  files: PupilUnitLessonFile[];
  revisionScore: number | null;
  revisionMaxScore: number | null;
  revisionDate: string | null;
  lessonScore: number | null;
  lessonMaxScore: number | null;
  resubmitCount: number;
  avgSubmissionsPerActivity: number | null;  // ← ADD
};
```

- [ ] Build: `pnpm build 2>&1 | head -40`

---

### Step 2.3 — Render avg submissions pill in `PupilUnitsView`

**File:** `src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx`

Find where each lesson card is rendered. In the card body, lessons are rendered in the `selectedUnit.lessons.map(...)` block (from line ~207). Each lesson shows a score badge; find that spot (the `lessonScore`/`lessonMaxScore` badge near lines ~196–202) and add the pill to the lesson card row.

Look for the section showing lesson title, date, objectives, and score badges. The avg submissions pill belongs alongside the other lesson-level stats. Add it after the lesson score badge:

```tsx
{typeof lesson.avgSubmissionsPerActivity === "number" && lesson.avgSubmissionsPerActivity > 0 && (
  <span
    className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300"
    title="Average submissions per activity"
  >
    {lesson.avgSubmissionsPerActivity === 1
      ? "avg 1 attempt"
      : `avg ${lesson.avgSubmissionsPerActivity} attempts`}
  </span>
)}
```

To find the exact insertion point: search for `lessonScore` in the view file. It's used in `isLessonOverdueAndUnderperforming` and also in the render JSX. The render location will be around the lesson card body where dates and scores are shown.

- [ ] Start dev server: `pnpm dev`
- [ ] Navigate to `/pupil-lessons/[any-pupil-id]`
- [ ] Verify that lessons where the pupil has submitted activities show the avg attempts pill
- [ ] Verify that lessons with no submissions show no pill

- [ ] Build: `pnpm build 2>&1 | head -40`

- [ ] Commit:
```bash
git add src/lib/server-actions/pupil-units.ts \
        src/lib/pupil-units-data.ts \
        src/app/pupil-lessons/\[pupilId\]/pupil-units-view.tsx
git commit -m "feat: show average submissions per activity on pupil units page"
```

---

## Verification Checklist

Before calling this done, confirm:

- [ ] A scorable activity shows "1 attempt" on first submit, "2 attempts" after resubmit
- [ ] Non-scorable activities (display-image, show-video, etc.) do not show the pill
- [ ] The pill is absent if the pupil has never submitted
- [ ] The avg submissions stat on the pupil-units page rounds to 1 decimal (e.g. "avg 1.5 attempts")
- [ ] No TypeScript errors: `pnpm build` exits 0
- [ ] No ESLint errors: `pnpm lint`
