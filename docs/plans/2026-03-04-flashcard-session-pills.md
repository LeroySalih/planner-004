# Flashcard Session Pills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display the most recent completed session's date and score as colour-coded pills on each flashcard activity in the sidebar.

**Architecture:** Extend the bootstrap server action to fetch the latest completed session per activity for the current pupil, enrich the `FlashcardActivity` type with `lastSession`, and render date/score pills in the sidebar buttons inside `FlashcardsShell`.

**Tech Stack:** Next.js 15 App Router, TypeScript, PostgreSQL via `pg`, Tailwind CSS v4, React 19

---

### Task 1: Add session summary query to bootstrap action

**Files:**
- Modify: `src/lib/server-actions/flashcards.ts`

**Step 1: Add `lastSession` to `FlashcardActivity` type**

In `src/lib/server-actions/flashcards.ts`, update the exported type (around line 11):

```ts
export type FlashcardActivity = {
  activityId: string
  activityTitle: string
  lessonId: string
  lessonTitle: string
  lastSession?: {
    completedAt: string   // ISO string
    score: number         // correct_count / total_cards, 0–1
  }
}
```

**Step 2: Add session summary query inside `readFlashcardsBootstrapAction`**

After the block that builds `flashcardActivities` (after line 82, before the `return`), add:

```ts
// Fetch most recent completed session per activity for this pupil
if (flashcardActivities.length > 0) {
  const activityIds = flashcardActivities.map((a) => a.activityId)
  const sessionResult = await query<{
    activity_id: string
    completed_at: string
    correct_count: number
    total_cards: number
  }>(
    `
    SELECT DISTINCT ON (activity_id)
      activity_id,
      completed_at,
      correct_count,
      total_cards
    FROM flashcard_sessions
    WHERE pupil_id = $1
      AND status = 'completed'
      AND activity_id = ANY($2::text[])
    ORDER BY activity_id, completed_at DESC
    `,
    [pupilId, activityIds],
  )

  const sessionMap = new Map(
    sessionResult.rows.map((row) => [
      row.activity_id,
      {
        completedAt: row.completed_at,
        score: row.total_cards > 0 ? row.correct_count / row.total_cards : 0,
      },
    ]),
  )

  flashcardActivities = flashcardActivities.map((a) => ({
    ...a,
    lastSession: sessionMap.get(a.activityId),
  }))
}
```

**Step 3: Verify the dev server compiles without errors**

Run: `pnpm dev`
Expected: No TypeScript errors in terminal output.

**Step 4: Commit**

```bash
git add src/lib/server-actions/flashcards.ts
git commit -m "feat: extend flashcard bootstrap with latest session summary per activity"
```

---

### Task 2: Update `FlashcardsShell` to accept and propagate `lastSession`

**Files:**
- Modify: `src/components/flashcards/flashcards-shell.tsx`

**Step 1: Update the local `FlashcardActivity` type**

The shell defines its own local `FlashcardActivity` type (line 23). Update it to include `lastSession`:

```ts
type FlashcardActivity = {
  activityId: string
  activityTitle: string
  lessonId: string
  lessonTitle: string
  lastSession?: {
    completedAt: string
    score: number
  }
}
```

**Step 2: Add pill helper at the top of the file (after imports)**

```ts
function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const yyyy = d.getFullYear()
  return `${dd}-${mm}-${yyyy}`
}

function isWithin30Days(iso: string): boolean {
  const diffMs = Date.now() - new Date(iso).getTime()
  return diffMs < 30 * 24 * 60 * 60 * 1000
}
```

**Step 3: Render pills inside each activity button**

Locate the `<Button>` for each activity (around line 181). Replace:

```tsx
<Button
  key={activity.activityId}
  variant={isSelected ? "secondary" : "ghost"}
  className={cn(
    "justify-start text-left h-auto py-2 pl-5",
    isSelected && "font-medium",
  )}
  onClick={() => handleActivityClick(activity.activityId)}
>
  {activity.activityTitle}
</Button>
```

With:

```tsx
<Button
  key={activity.activityId}
  variant={isSelected ? "secondary" : "ghost"}
  className={cn(
    "justify-start text-left h-auto py-2 pl-5 flex-col items-start gap-1",
    isSelected && "font-medium",
  )}
  onClick={() => handleActivityClick(activity.activityId)}
>
  <span>{activity.activityTitle}</span>
  {activity.lastSession && (
    <span className="flex gap-1.5">
      <span
        className={cn(
          "text-xs rounded-full px-2 py-0.5 font-normal",
          isWithin30Days(activity.lastSession.completedAt)
            ? "bg-green-100 text-green-800"
            : "bg-red-100 text-red-800",
        )}
      >
        {formatDate(activity.lastSession.completedAt)}
      </span>
      <span
        className={cn(
          "text-xs rounded-full px-2 py-0.5 font-normal",
          activity.lastSession.score > 0.8
            ? "bg-green-100 text-green-800"
            : "bg-red-100 text-red-800",
        )}
      >
        {Math.round(activity.lastSession.score * 100)}%
      </span>
    </span>
  )}
</Button>
```

**Step 4: Verify the page renders correctly**

Navigate to `http://localhost:3000/flashcards?unitId=1005-Materials` in the browser.
Expected:
- Activities with a completed session show a date pill and a score pill below the title.
- Activities with no completed session show title only.
- Green pills for recent dates (≤30 days) and scores >80%, red otherwise.

**Step 5: Commit**

```bash
git add src/components/flashcards/flashcards-shell.tsx
git commit -m "feat: display last session date and score pills in flashcard sidebar"
```

---

### Task 3: Smoke-test edge cases manually

Before calling this done, verify the following in the browser:

1. **No sessions yet** — an activity with no completed sessions shows no pills.
2. **Score exactly 80%** — should show a red pill (condition is `> 0.8`, not `>= 0.8`).
3. **Score 100%** — green pill.
4. **Old session (> 30 days ago)** — date pill is red.
5. **Recent session (today)** — date pill is green.

If any edge case looks wrong, fix and re-commit before marking done.
