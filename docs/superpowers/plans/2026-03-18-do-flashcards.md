# Do Flashcards Activity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `do-flashcards` scorable activity type that lets pupils complete a flashcard set inside a modal dialog, with scores recorded progressively in the `submissions` table like all other scorable activities.

**Architecture:** `do-flashcards` is registered as a scorable activity type. A dedicated `upsertDoFlashcardsSubmissionAction` writes/updates a `submissions` row on every card attempt. `FlashcardSession` gains an optional `doActivityId` prop that wires the upsert calls — the existing `display-flashcards` code path is unchanged. A SQL migration injects `do-flashcards` activities for existing flashcard sets and backfills historical scores.

**Tech Stack:** Next.js 15 App Router, TypeScript, PostgreSQL (`pg` direct), Zod, Radix UI Dialog, Tailwind CSS v4, Sonner toasts.

**Spec:** `docs/superpowers/specs/2026-03-18-do-flashcards-design.md`

**Working tree:** `.worktrees/do-flashcards` (port 3001)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/dino.config.ts` | Modify | Add `do-flashcards` to `SCORABLE_ACTIVITY_TYPES` |
| `src/lib/server-actions/do-flashcards.ts` | Create | `upsertDoFlashcardsSubmissionAction` + `readDoFlashcardsActivityBodyAction` |
| `src/lib/server-actions/flashcards.ts` | Modify | Add optional `doActivityId` param to `startFlashcardSessionAction` |
| `src/lib/server-updates.ts` | Modify | Re-export new actions |
| `src/components/flashcards/flashcard-session.tsx` | Modify | Accept optional `doActivityId` prop; call upsert after each attempt |
| `src/components/pupil/pupil-do-flashcards-activity.tsx` | Create | Pupil-facing activity card + modal trigger for `do-flashcards` |
| `src/components/units/lesson-sidebar.tsx` | Modify | Add `do-flashcards` to `ACTIVITY_TYPES`; add flashcard-set dropdown config panel |
| `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx` | Modify | Render `PupilDoFlashcardsActivity` when `activity.type === "do-flashcards"` |
| `src/migrations/070-do-flashcards.sql` | Create | Schema change + data migration |

---

## Task 1: Register `do-flashcards` as a scorable activity type

**Files:**
- Modify: `src/dino.config.ts`

- [ ] **Step 1: Open `src/dino.config.ts` and add `"do-flashcards"` to `SCORABLE_ACTIVITY_TYPES`**

Find the array:
```typescript
export const SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "multiple-choice-question",
  "short-text-question",
  "text-question",
  "long-text-question",
  "upload-file",
  "upload-url",
  "feedback",
  "sketch-render",
])
```

Add `"do-flashcards"` to the end:
```typescript
export const SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "multiple-choice-question",
  "short-text-question",
  "text-question",
  "long-text-question",
  "upload-file",
  "upload-url",
  "feedback",
  "sketch-render",
  "do-flashcards",
])
```

- [ ] **Step 2: Verify the build still compiles**

Run: `cd .worktrees/do-flashcards && pnpm build 2>&1 | tail -20`
Expected: No TypeScript errors. (Build may warn on unrelated things — focus on type errors.)

- [ ] **Step 3: Commit**

```bash
git add src/dino.config.ts
git commit -m "feat: register do-flashcards as scorable activity type"
```

---

## Task 2: Write the SQL migration

**Files:**
- Create: `src/migrations/070-do-flashcards.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration 070: do-flashcards activity type
-- Adds do_activity_id to flashcard_sessions, injects do-flashcards activities
-- for existing display-flashcards, and backfills submission scores.

-- Step 1: Add do_activity_id column to flashcard_sessions
ALTER TABLE flashcard_sessions
  ADD COLUMN IF NOT EXISTS do_activity_id text;

-- Step 2: Inject do-flashcards activities for every existing display-flashcards activity
-- Uses gen_random_uuid() for new activity IDs.
WITH inserted AS (
  INSERT INTO activities (activity_id, lesson_id, title, type, body_data, order_by, active, is_summative)
  SELECT
    gen_random_uuid()::text,
    a.lesson_id,
    'Do: ' || coalesce(a.title, 'Flashcards'),
    'do-flashcards',
    jsonb_build_object('flashcardActivityId', a.activity_id),
    coalesce(a.order_by, 0) + 1,
    true,
    false
  FROM activities a
  WHERE a.type = 'display-flashcards'
    AND coalesce(a.active, true) = true
  RETURNING activity_id, (body_data->>'flashcardActivityId') AS source_activity_id
)
-- Step 3: Backfill submissions for completed flashcard sessions
-- One submission per completed session where total_cards > 0.
INSERT INTO submissions (submission_id, activity_id, user_id, submitted_at, body, is_flagged)
SELECT
  gen_random_uuid()::text,
  i.activity_id,
  fs.pupil_id,
  fs.completed_at,
  jsonb_build_object(
    'score',        fs.correct_count::float / fs.total_cards,
    'correctCount', fs.correct_count,
    'totalCards',   fs.total_cards,
    'sessionId',    fs.session_id
  ),
  false
FROM flashcard_sessions fs
JOIN inserted i ON i.source_activity_id = fs.activity_id
WHERE fs.status = 'completed'
  AND fs.total_cards > 0;

-- Step 4: Backfill do_activity_id on migrated sessions
UPDATE flashcard_sessions fs
SET do_activity_id = i.activity_id
FROM (
  SELECT activity_id, (body_data->>'flashcardActivityId') AS source_activity_id
  FROM activities
  WHERE type = 'do-flashcards'
) i
WHERE fs.activity_id = i.source_activity_id;
```

- [ ] **Step 2: Apply the migration to the dev database**

```bash
psql "postgresql://postgres:your-super-secret-and-long-postgres-password@localhost:5432/postgres-do-flashcards?sslmode=disable" \
  -f src/migrations/070-do-flashcards.sql
```

Expected: `ALTER TABLE`, `INSERT 0 N`, `INSERT 0 M`, `UPDATE N` (counts depend on existing data). No errors.

- [ ] **Step 3: Verify the migration results**

```bash
psql "postgresql://postgres:your-super-secret-and-long-postgres-password@localhost:5432/postgres-do-flashcards?sslmode=disable" \
  -c "SELECT count(*) FROM activities WHERE type = 'do-flashcards';"
psql "postgresql://postgres:your-super-secret-and-long-postgres-password@localhost:5432/postgres-do-flashcards?sslmode=disable" \
  -c "SELECT count(*) FROM submissions s JOIN activities a ON a.activity_id = s.activity_id WHERE a.type = 'do-flashcards';"
```

Expected: First count equals the number of `display-flashcards` activities. Second count equals the number of completed sessions with `total_cards > 0`.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/070-do-flashcards.sql
git commit -m "feat: add migration 070 for do-flashcards activities and score backfill"
```

---

## Task 3: Create `upsertDoFlashcardsSubmissionAction`

**Files:**
- Create: `src/lib/server-actions/do-flashcards.ts`
- Modify: `src/lib/server-updates.ts`

- [ ] **Step 1: Create `src/lib/server-actions/do-flashcards.ts`**

```typescript
"use server"

import { query, withDbClient } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"

export async function upsertDoFlashcardsSubmissionAction(input: {
  doActivityId: string
  pupilId: string
  sessionId: string
  correctCount: number
  totalCards: number
  submissionId: string | null
  isFinal?: boolean
}): Promise<{ data: { submissionId: string } | null; error: string | null }> {
  return withTelemetry(
    {
      routeTag: "/do-flashcards:upsert-submission",
      functionName: "upsertDoFlashcardsSubmissionAction",
      params: { doActivityId: input.doActivityId, sessionId: input.sessionId },
    },
    async () => {
      const { doActivityId, pupilId, sessionId, correctCount, totalCards, submissionId, isFinal } = input

      if (!doActivityId || !pupilId || !sessionId) {
        return { data: null, error: "Missing required fields." }
      }

      const score = totalCards > 0 ? correctCount / totalCards : 0
      const body = JSON.stringify({ score, correctCount, totalCards, sessionId })

      try {
        // CRITICAL: The body MUST include a `score` field (0–1 float).
      // compute_submission_base_score reads body->>'score' for this activity type.
      // If `score` is absent, the activity will show as unscored in all grids.
      if (submissionId === null) {
          // First attempt: INSERT new submission row
          const result = await query<{ submission_id: string }>(
            `
            INSERT INTO submissions (submission_id, activity_id, user_id, body, is_flagged${isFinal ? ", submitted_at" : ""})
            VALUES (gen_random_uuid(), $1, $2, $3, false${isFinal ? ", now()" : ""})
            RETURNING submission_id
            `,
            [doActivityId, pupilId, body],
          )
          return { data: { submissionId: result.rows[0].submission_id }, error: null }
        } else {
          // Subsequent attempts: UPDATE existing row
          await query(
            `
            UPDATE submissions
            SET body = $1${isFinal ? ", submitted_at = now()" : ""}
            WHERE submission_id = $2
            `,
            [body, submissionId],
          )
          return { data: { submissionId }, error: null }
        }
      } catch (error) {
        console.error("[do-flashcards] Failed to upsert submission", error)
        const message = error instanceof Error ? error.message : "Unable to save flashcard score."
        return { data: null, error: message }
      }
    },
  )
}

/**
 * Reads all display-flashcards activities in the same unit as a given lesson,
 * for populating the teacher sidebar dropdown.
 */
export async function readUnitFlashcardActivitiesAction(
  lessonId: string,
): Promise<{ data: Array<{ activityId: string; title: string }> | null; error: string | null }> {
  return withTelemetry(
    {
      routeTag: "/do-flashcards:read-unit-flashcard-activities",
      functionName: "readUnitFlashcardActivitiesAction",
      params: { lessonId },
    },
    async () => {
      if (!lessonId) {
        return { data: null, error: "Missing lesson ID." }
      }

      try {
        const result = await query<{ activity_id: string; title: string | null }>(
          `
          SELECT a.activity_id, a.title
          FROM activities a
          JOIN lessons l ON l.lesson_id = a.lesson_id
          WHERE a.type = 'display-flashcards'
            AND coalesce(a.active, true) = true
            AND l.unit_id = (
              SELECT unit_id FROM lessons WHERE lesson_id = $1 LIMIT 1
            )
          ORDER BY l.order_by ASC NULLS LAST, a.order_by ASC NULLS LAST
          `,
          [lessonId],
        )
        return {
          data: result.rows.map((row) => ({
            activityId: row.activity_id,
            title: row.title ?? "Flashcards",
          })),
          error: null,
        }
      } catch (error) {
        console.error("[do-flashcards] Failed to read unit flashcard activities", error)
        const message = error instanceof Error ? error.message : "Unable to load flashcard sets."
        return { data: null, error: message }
      }
    },
  )
}
```

- [ ] **Step 2: Export from `src/lib/server-updates.ts`**

Find the flashcard exports block in `server-updates.ts` (around line 239) and add below it:

```typescript
export {
  readUnitFlashcardActivitiesAction,
  upsertDoFlashcardsSubmissionAction,
} from "./server-actions/do-flashcards"
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd .worktrees/do-flashcards && pnpm build 2>&1 | tail -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server-actions/do-flashcards.ts src/lib/server-updates.ts
git commit -m "feat: add upsertDoFlashcardsSubmissionAction and readUnitFlashcardActivitiesAction"
```

---

## Task 4: Extend `startFlashcardSessionAction` with `doActivityId`

**Files:**
- Modify: `src/lib/server-actions/flashcards.ts`

The existing `startFlashcardSessionAction(activityId, totalCards, pupilId, activityTitle?)` takes 4 positional params. Add an optional 5th `doActivityId?` that is written to the new `do_activity_id` column.

- [ ] **Step 1: Update the INSERT in `startFlashcardSessionAction`**

Find the existing INSERT (line ~224):
```typescript
export async function startFlashcardSessionAction(
  activityId: string,
  totalCards: number,
  pupilId: string,
  activityTitle?: string,
) {
```

Replace with:
```typescript
export async function startFlashcardSessionAction(
  activityId: string,
  totalCards: number,
  pupilId: string,
  activityTitle?: string,
  doActivityId?: string,
) {
```

Find the INSERT SQL inside:
```sql
INSERT INTO flashcard_sessions (pupil_id, activity_id, total_cards)
VALUES ($1, $2, $3)
RETURNING session_id
```

Replace with:
```sql
INSERT INTO flashcard_sessions (pupil_id, activity_id, total_cards, do_activity_id)
VALUES ($1, $2, $3, $4)
RETURNING session_id
```

And update the params array from `[pupilId, activityId, totalCards]` to `[pupilId, activityId, totalCards, doActivityId ?? null]`.

- [ ] **Step 2: Verify the existing `display-flashcards` call site is unaffected**

The call in `flashcard-session.tsx` (line 78) passes only 4 args — `doActivityId` will be `undefined`, which maps to `null` in the DB. This is correct.

Run: `pnpm build 2>&1 | tail -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-actions/flashcards.ts
git commit -m "feat: add optional doActivityId param to startFlashcardSessionAction"
```

---

## Task 5: Extend `FlashcardSession` to write progressive submission scores

**Files:**
- Modify: `src/components/flashcards/flashcard-session.tsx`

The component will accept an optional `doActivityId` prop and call `upsertDoFlashcardsSubmissionAction` after each card attempt and on session complete. The `display-flashcards` path is unaffected because `doActivityId` is optional.

- [ ] **Step 1: Add import and prop type**

At the top of the file, add to the imports:
```typescript
import { upsertDoFlashcardsSubmissionAction } from "@/lib/server-updates"
```

Update `FlashcardSessionProps`:
```typescript
type FlashcardSessionProps = {
  deck: Deck
  pupilId: string
  doActivityId?: string           // present when used from do-flashcards activity
  onScoreUpdate?: (score: number) => void  // called after each upsert with latest 0-1 score
}
```

- [ ] **Step 2: Add state for tracking submission ID**

Inside `FlashcardSession`, add:
```typescript
const submissionIdRef = useRef<string | null>(null)
```

- [ ] **Step 3: Update `startFlashcardSessionAction` call to pass `doActivityId`**

Find the call at line 78:
```typescript
const result = await startFlashcardSessionAction(
  deck.activityId,
  deck.cards.length,
  pupilId,
  deck.activityTitle,
)
```

Replace with:
```typescript
const result = await startFlashcardSessionAction(
  deck.activityId,
  deck.cards.length,
  pupilId,
  deck.activityTitle,
  doActivityId,
)
```

- [ ] **Step 4: Call `upsertDoFlashcardsSubmissionAction` after each attempt**

In `handleSubmit`, after the `void recordFlashcardAttemptAction(...)` call (line 127), add:

```typescript
// Write progressive score to submissions when used as do-flashcards
if (doActivityId && sessionId) {
  void upsertDoFlashcardsSubmissionAction({
    doActivityId,
    pupilId,
    sessionId,
    correctCount: newCorrectCount,
    totalCards: deck.cards.length,
    submissionId: submissionIdRef.current,
  }).then((result) => {
    if (result.data) {
      submissionIdRef.current = result.data.submissionId
      onScoreUpdate?.(deck.cards.length > 0 ? newCorrectCount / deck.cards.length : 0)
    }
  })
}
```

- [ ] **Step 5: Call `upsertDoFlashcardsSubmissionAction` with `isFinal: true` on complete**

In `handleNext`, find the `completeFlashcardSessionAction(...)` call (line 163). After it, add:

```typescript
if (doActivityId && sessionId && submissionIdRef.current) {
  void upsertDoFlashcardsSubmissionAction({
    doActivityId,
    pupilId,
    sessionId,
    correctCount: totalCorrectAnswers,
    totalCards: pile.length,
    submissionId: submissionIdRef.current,
    isFinal: true,
  }).then((result) => {
    if (result.data) {
      onScoreUpdate?.(pile.length > 0 ? totalCorrectAnswers / pile.length : 0)
    }
  })
}
```

- [ ] **Step 6: Reset `submissionIdRef` on restart**

In `handleRestart`, before `startSession()`, add:
```typescript
submissionIdRef.current = null
```

- [ ] **Step 7: Verify no regressions on existing display-flashcards flow**

Run: `pnpm build 2>&1 | tail -20`
Open browser at http://localhost:3001 and navigate to the `/flashcards` page. Verify the existing flashcard experience still works (a session starts, cards appear, attempts are recorded).

- [ ] **Step 8: Commit**

```bash
git add src/components/flashcards/flashcard-session.tsx
git commit -m "feat: extend FlashcardSession to write progressive submissions for do-flashcards"
```

---

## Task 6: Create `PupilDoFlashcardsActivity` component

This is the pupil-facing activity card rendered inside the lesson page. It shows the latest score, a "Start Flashcards" button, and opens a modal containing `FlashcardSession`.

**Files:**
- Create: `src/components/pupil/pupil-do-flashcards-activity.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { FlashcardSession } from "@/components/flashcards/flashcard-session"
import { readFlashcardDeckAction } from "@/lib/server-updates"
import type { LessonActivity } from "@/types"

interface PupilDoFlashcardsActivityProps {
  activity: LessonActivity
  pupilId: string
  initialScore: number | null  // 0-1 from latest submission, or null if none
}

function getFlashcardActivityId(activity: LessonActivity): string | null {
  const body = activity.body_data
  if (typeof body !== "object" || body === null) return null
  const id = (body as Record<string, unknown>).flashcardActivityId
  return typeof id === "string" && id.length > 0 ? id : null
}

export function PupilDoFlashcardsActivity({
  activity,
  pupilId,
  initialScore,
}: PupilDoFlashcardsActivityProps) {
  const flashcardActivityId = getFlashcardActivityId(activity)
  const [open, setOpen] = useState(false)
  const [deck, setDeck] = useState<{
    activityId: string
    activityTitle: string
    lessonTitle: string
    cards: Array<{ sentence: string; answer: string; template: string }>
  } | null>(null)
  const [deckError, setDeckError] = useState<string | null>(null)
  const [loadingDeck, setLoadingDeck] = useState(false)
  const [latestScore, setLatestScore] = useState<number | null>(initialScore)

  const handleOpen = useCallback(async () => {
    if (!flashcardActivityId) return
    if (deck) {
      setOpen(true)
      return
    }
    setLoadingDeck(true)
    const result = await readFlashcardDeckAction(flashcardActivityId)
    setLoadingDeck(false)
    if (result.error || !result.data) {
      setDeckError(result.error ?? "Could not load flashcard set.")
      return
    }
    if (result.data.cards.length === 0) {
      setDeckError("This flashcard set has no cards yet.")
      return
    }
    setDeck(result.data)
    setOpen(true)
  }, [flashcardActivityId, deck])

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  const handleScoreUpdate = useCallback((score: number) => {
    setLatestScore(score)
  }, [])

  if (!flashcardActivityId) {
    return (
      <p className="text-sm text-muted-foreground">Flashcard set unavailable.</p>
    )
  }

  const scoreDisplay =
    latestScore !== null ? `${Math.round(latestScore * 100)}%` : null

  return (
    <>
      <div className="flex items-center gap-3">
        {scoreDisplay && (
          <span className="text-sm font-medium text-foreground">{scoreDisplay}</span>
        )}
        <Button
          size="sm"
          onClick={handleOpen}
          disabled={loadingDeck}
        >
          {loadingDeck ? "Loading…" : "Start Flashcards"}
        </Button>
        {deckError && (
          <p className="text-sm text-destructive">{deckError}</p>
        )}
      </div>

      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose() }}>
        <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <DialogTitle>{activity.title || "Flashcards"}</DialogTitle>
          {deck && (
            <FlashcardSession
              key={`${deck.activityId}-${open}`}
              deck={deck}
              pupilId={pupilId}
              doActivityId={activity.activity_id}
              onScoreUpdate={handleScoreUpdate}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm build 2>&1 | tail -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/pupil/pupil-do-flashcards-activity.tsx
git commit -m "feat: add PupilDoFlashcardsActivity component with modal and progressive scoring"
```

---

## Task 7: Wire `PupilDoFlashcardsActivity` into the pupil lesson page

**Files:**
- Modify: `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`

The pupil lesson page has a large chain of `activity.type === "X" ? <ComponentX> : ...` at around line 869. We need to add `do-flashcards` to this chain.

- [ ] **Step 1: Import the new component**

Find the existing imports near the top of the file (around line 40):
```typescript
import { PupilMcqActivity } from "@/components/pupil/pupil-mcq-activity"
```

Add below it:
```typescript
import { PupilDoFlashcardsActivity } from "@/components/pupil/pupil-do-flashcards-activity"
```

- [ ] **Step 2: Add `do-flashcards` to the scorable activity filter**

The page builds `inputActivityTypes` (a Set) to determine which activities show a progress bar. Find it (around line 857):
```typescript
const showProgress = inputActivityTypes.has(activity.type ?? "")
```

Find where `inputActivityTypes` is built and ensure `"do-flashcards"` is included. Search for `inputActivityTypes` in the file — it likely populates from `isScorableActivityType()` or a hardcoded set. If it derives from `SCORABLE_ACTIVITY_TYPES`, it will pick up `do-flashcards` automatically. If hardcoded, add `"do-flashcards"`.

- [ ] **Step 3: Find the initial score for do-flashcards activities**

The page already loads `submissionSummaries` for scorable activities. `do-flashcards` will be included automatically once it's in `SCORABLE_ACTIVITY_TYPES` and the RPC is used. Verify by checking how `submissionSummaries` or initial scores are fetched — look for `readLessonSubmissionSummariesAction` calls. The score passed to `PupilDoFlashcardsActivity` as `initialScore` should come from the same mechanism as other scorable activities.

If the page already has a pattern like:
```typescript
const submissionMap = new Map(submissionSummaries.map((s) => [s.activity_id, s]))
const initialScore = submissionMap.get(activity.activity_id)?.score ?? null
```

Then use that. Otherwise, pass `null` initially (score will be set by `onScoreUpdate` on first attempt).

- [ ] **Step 4: Add the `do-flashcards` branch in the activity rendering chain**

Find the existing chain around line 881:
```typescript
) : activity.type === "short-text-question" ? (
  <PupilShortTextActivity ...
```

Add a new branch for `do-flashcards`. Place it before the fallback/null case:
```typescript
) : activity.type === "do-flashcards" ? (
  <PupilDoFlashcardsActivity
    activity={activity}
    pupilId={pupilId}
    initialScore={/* score from submissionMap or null */}
  />
```

- [ ] **Step 5: Verify the page renders without errors**

Run: `pnpm build 2>&1 | tail -20`
Expected: No type errors.

Open http://localhost:3001 and navigate to a pupil lesson page that has a `do-flashcards` activity (created by the migration). Verify:
- The activity card shows "Start Flashcards"
- Clicking opens the modal with the flashcard session
- After answering a card, the score updates
- Closing the modal shows the new score on the activity card

- [ ] **Step 6: Commit**

```bash
git add src/app/pupil-lessons/\[pupilId\]/lessons/\[lessonId\]/page.tsx
git commit -m "feat: render PupilDoFlashcardsActivity in pupil lesson page"
```

---

## Task 8: Teacher sidebar — add `do-flashcards` type and flashcard-set dropdown

**Files:**
- Modify: `src/components/units/lesson-sidebar.tsx`

- [ ] **Step 1: Add `do-flashcards` to `ACTIVITY_TYPES`**

Find the `ACTIVITY_TYPES` array (line 58):
```typescript
const ACTIVITY_TYPES = [
  { value: "text", label: "Text" },
  ...
  { value: "voice", label: "Voice recording" },
] as const
```

Add `do-flashcards` to the list:
```typescript
  { value: "do-flashcards", label: "Do Flashcards" },
```

Position it near the `display-flashcards` logic for grouping, or at the end — either is fine.

- [ ] **Step 2: Update the `ActivityTypeValue` type**

The type is inferred from the array:
```typescript
type ActivityTypeValue = (typeof ACTIVITY_TYPES)[number]["value"]
```

This updates automatically — no change needed.

- [ ] **Step 3: Add import for the new server action**

Find the server-updates import block (around line 36) and add `readUnitFlashcardActivitiesAction`:
```typescript
import {
  ...
  readUnitFlashcardActivitiesAction,
} from "@/lib/server-updates"
```

- [ ] **Step 4: Add the flashcard-set dropdown config panel**

In the activity config section (around line 1715), where other type-specific panels are rendered (e.g. `{activity.type === "text" ? ...}`), add:

```typescript
{activity.type === "do-flashcards" ? (
  <DoFlashcardsConfig
    activity={activity}
    lessonId={lesson.lesson_id}
    onBodyChange={(newBody) => {
      // Optimistic local update
      updateActivityBodyLocally(activity.activity_id, newBody)
      // Save directly with the new value — do NOT call handleActivityBodySubmit
      // because that reads body_data from React state which is stale at this point.
      startTransition(async () => {
        const result = await updateLessonActivityAction(unitId, lesson.lesson_id, activity.activity_id, {
          bodyData: newBody,
          type: activity.type,
        })
        if (!result.success || !result.data) {
          toast.error("Failed to update flashcard set", {
            description: result.error ?? "Please try again later.",
          })
          await refreshActivities()
        }
      })
    }}
    disabled={isPending}
  />
) : null}
```

> **Important:** Do NOT use `handleActivityBodySubmit(activityId)` here. That function reads `body_data` from the `activities` React state, which has not yet updated when the `onValueChange` handler fires. Calling it would silently write the stale (pre-change) body to the database. Always pass the new value directly to `updateLessonActivityAction`.

- [ ] **Step 5: Create the `DoFlashcardsConfig` sub-component in the same file**

Add this function near the bottom of `lesson-sidebar.tsx`, before the closing exports:

```typescript
function DoFlashcardsConfig({
  activity,
  lessonId,
  onBodyChange,
  disabled,
}: {
  activity: LessonActivity
  lessonId: string
  onBodyChange: (body: Record<string, unknown>) => void
  disabled: boolean
}) {
  const [options, setOptions] = useState<Array<{ activityId: string; title: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    readUnitFlashcardActivitiesAction(lessonId).then((result) => {
      setOptions(result.data ?? [])
      setLoading(false)
    })
  }, [lessonId])

  const currentId =
    typeof activity.body_data === "object" && activity.body_data !== null
      ? ((activity.body_data as Record<string, unknown>).flashcardActivityId as string | undefined) ?? ""
      : ""

  if (loading) {
    return <p className="mt-3 text-xs text-muted-foreground">Loading flashcard sets…</p>
  }

  if (options.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        No flashcard sets in this unit — add a Flashcards activity first.
      </p>
    )
  }

  return (
    <div className="mt-3 space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">Flashcard set</Label>
      <Select
        value={currentId}
        onValueChange={(value) => onBodyChange({ flashcardActivityId: value })}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue placeholder="Select a flashcard set…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.activityId} value={opt.activityId}>
              {opt.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

Note: `useState` and `useEffect` are already imported in this file. `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`, `Label` are already imported.

- [ ] **Step 6: Verify the build**

Run: `pnpm build 2>&1 | tail -20`
Expected: No type errors.

Open http://localhost:3001 and navigate to a lesson sidebar. Verify:
- "Do Flashcards" appears in the activity type dropdown
- When selected, the "Flashcard set" dropdown appears
- The dropdown is populated with `display-flashcards` activities from the unit
- Selecting one saves the `flashcardActivityId` to the activity's `body_data`

- [ ] **Step 7: Commit**

```bash
git add src/components/units/lesson-sidebar.tsx
git commit -m "feat: add do-flashcards type and flashcard-set config dropdown to lesson sidebar"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full build check**

Run: `pnpm build 2>&1 | tail -30`
Expected: Clean build with no TypeScript errors.

- [ ] **Step 2: Lint check**

Run: `pnpm lint 2>&1 | tail -20`
Fix any lint errors before proceeding.

- [ ] **Step 3: End-to-end smoke test**

Manually test the full flow at http://localhost:3001:

**Teacher flow:**
1. Open a lesson sidebar
2. Add a new activity, select type "Do Flashcards"
3. Verify the "Flashcard set" dropdown appears with available flashcard sets
4. Select one and verify it saves (check by refreshing the page)

**Pupil flow:**
1. Open a pupil lesson page that has a `do-flashcards` activity
2. Verify the activity card shows "Start Flashcards" and no score initially
3. Click "Start Flashcards" — modal opens with the flashcard session
4. Answer one card — verify a submission row is created in the DB:
   ```bash
   psql "postgresql://postgres:your-super-secret-and-long-postgres-password@localhost:5432/postgres-do-flashcards?sslmode=disable" \
     -c "SELECT activity_id, user_id, submitted_at, body FROM submissions ORDER BY ctid DESC LIMIT 3;"
   ```
5. Answer more cards — verify score updates in the modal
6. Close the modal — verify the activity card shows the updated score
7. Reopen the modal — verify a new session starts, score resets in UI, but history is preserved in DB

**Migration verification:**
- Verify existing `display-flashcards` activities have a paired `do-flashcards` activity
- Verify completed historical sessions have a `submissions` row

- [ ] **Step 4: Commit any final fixes**

```bash
git add -p  # stage only intended changes
git commit -m "fix: final adjustments from smoke test"
```

---

## Task 10: Invoke finishing-a-development-branch skill

Once all tests pass and the smoke test is complete, use the `superpowers:finishing-a-development-branch` skill to decide how to integrate this work.

- [ ] **Step 1: Invoke the skill**

```
Use superpowers:finishing-a-development-branch
```
