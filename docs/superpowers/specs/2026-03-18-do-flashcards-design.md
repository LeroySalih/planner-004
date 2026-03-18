# Do Flashcards Activity — Design Spec

**Date:** 2026-03-18
**Status:** Approved

---

## Overview

Introduce a new `do-flashcards` scorable activity type that allows teachers to assign flashcard practice as a graded activity within a lesson. The pupil completes the flashcard set inside a modal dialog using the existing flashcard engine, and their score is recorded progressively in the standard `submissions` table — giving the activity full parity with all other scorable activity types.

Existing `display-flashcards` functionality and its database tables (`flashcard_sessions`, `flashcard_attempts`) are unchanged in structure. The server actions that write to those tables are extended to also write to `submissions`.

---

## 1. Activity Type & Data Model

### Activity type registration

`do-flashcards` is added to `SCORABLE_ACTIVITY_TYPES` in `src/dino.config.ts`.

### `activities.body_data` shape — `do-flashcards`

```json
{
  "flashcardActivityId": "act_abc123"
}
```

`flashcardActivityId` references the `activity_id` of a `display-flashcards` activity in the same unit. This is the card deck the pupil will practise. Validated at save time in the server action (must exist in same unit). No database foreign key constraint — if the referenced activity is deleted, the pupil card shows a "Flashcard set unavailable" error state and no session can be started.

### `display-flashcards` body_data (reference — unchanged)

```json
{
  "lines": "Line with **answer**\nAnother line **answer2**"
}
```

Parsed by `src/lib/flashcards/parse-flashcards.ts` into individual cards.

### Submission body shape

```json
{
  "score": 0.75,
  "correctCount": 9,
  "totalCards": 12,
  "sessionId": "sess_<nanoid>"
}
```

- `score` is a 0–1 decimal (`correctCount / totalCards`), compatible with `compute_submission_base_score` via the `score` field — no SQL changes required.
- `sessionId` uses the same ID generation pattern as other entities in the app (nanoid prefixed with `sess_`).
- If `totalCards = 0`, the session cannot be started (pupil card shows "No cards in this set").

### Multiple attempts

Each flashcard session produces one `submissions` row (identified by `submission_id`). The submission is created on the first card attempt, not on modal open, so the assignment grid never shows `0%` for an untouched session. Latest `submitted_at` is shown in assignment grids and progress views. Full session history accessible via `flashcard_sessions`.

---

## 2. Score Update Flow

Score is written via a dedicated `upsertDoFlashcardsSubmissionAction` — separate from `recordFlashcardAttemptAction` — to keep responsibilities clean and avoid silent failure from a lost `submissionId`.

1. **Modal opens** → `startFlashcardSessionAction(activityId, totalCards, pupilId, activityTitle?, doActivityId?)` — `activityId` is the `display-flashcards` ID (card source); `doActivityId` is the new optional 5th positional param. When provided, the action's `INSERT INTO flashcard_sessions` must include `do_activity_id = $5` (or equivalent). Returns `session_id`. No submission row yet.
2. **First card attempt** → `recordFlashcardAttemptAction(...)` records the attempt (unchanged). In parallel, the client calls `upsertDoFlashcardsSubmissionAction({ doActivityId, pupilId, sessionId, correctCount, totalCards, submissionId: null })` → INSERTs a `submissions` row, returns `submissionId`. Client stores `submissionId` in component state.
3. **Subsequent card attempts** → `recordFlashcardAttemptAction(...)` + `upsertDoFlashcardsSubmissionAction({ ..., submissionId })` → UPDATEs the existing submission by `submission_id`.
4. **Modal closes** → `completeFlashcardSessionAction(sessionId, correctCount, progress?)` marks the session complete (unchanged). Client calls `upsertDoFlashcardsSubmissionAction({ ..., submissionId, isFinal: true })` → final UPDATE setting `submitted_at = now()`.
5. **Lesson page** applies an optimistic update using the score computed locally from the final `correctCount / totalCards`.

**`upsertDoFlashcardsSubmissionAction` signature:**
```typescript
upsertDoFlashcardsSubmissionAction(input: {
  doActivityId: string
  pupilId: string
  sessionId: string
  correctCount: number
  totalCards: number
  submissionId: string | null   // null → INSERT and return new id; non-null → UPDATE
  isFinal?: boolean             // true → set submitted_at = now()
}): Promise<{ data: { submissionId: string } | null, error: string | null }>
```

**Error handling:** If the upsert fails on attempt 2+, the client retries with the same `submissionId`. If it fails on attempt 1 (INSERT), the client retries with `submissionId: null` — the INSERT is idempotent enough for this use case since duplicate sessions are unlikely and the score is always current.

**Backwards compatibility:** `startFlashcardSessionAction`, `recordFlashcardAttemptAction`, and `completeFlashcardSessionAction` are extended with optional new params only. When called from the existing `display-flashcards` flow (no `doActivityId`), they behave identically to today.

**`flashcard_sessions` column note:** `activity_id` continues to store the `display-flashcards` activity ID. A new nullable `do_activity_id text` column records the `do-flashcards` activity that initiated the session (added in migration Step 1).

**`submissions` insert note:** The `replication_pk` column has a sequence default — do not set it explicitly; the database provides it automatically.

---

## 3. Teacher UI

### Configuring a `do-flashcards` activity

In the lesson sidebar activity configuration panel, a `do-flashcards` activity shows a single **"Flashcard set"** dropdown. The dropdown is populated with all `display-flashcards` activities from the same unit, identified by title.

- Selecting a set saves `flashcardActivityId` to `body_data`.
- Saving validates that the selected activity exists in the same unit (server action check).
- If the unit has no `display-flashcards` activities, the dropdown shows: *"No flashcard sets in this unit — add a Flashcards activity first."*

### Adding the activity type

`do-flashcards` appears as **"Do Flashcards"** in the lesson activity type selector alongside existing types.

### No changes to `display-flashcards`

The existing flashcard content editor is untouched.

---

## 4. Pupil UI

### Activity card

The `do-flashcards` activity renders in the lesson view like all other scorable activities:
- If no submission exists: shows "Not started" / no score
- If a submission exists: shows latest score as a percentage (e.g. "75%")
- If the referenced flashcard set is missing: shows "Flashcard set unavailable"
- A **"Start Flashcards"** button opens the modal (disabled if set unavailable or `totalCards = 0`)

### Pupil score history

Pupils see only the latest score on the lesson page. History (multiple sessions) is not exposed in the pupil UI — it is available to teachers through the standard submission history view.

### Modal dialog

- Opens a large modal containing the existing `FlashcardSession` component, loaded with the card deck from the linked `display-flashcards` activity.
- Ordering, scoring, and feedback mechanics are identical to the current flashcard experience — no changes to `FlashcardSession` internals.
- A visible close button allows the pupil to exit at any time.
- On close: `completeFlashcardSessionAction()` is called, then the modal dismisses and the activity card updates with the score returned from the action.
- If close fails (network error): modal dismisses with a toast error; the running score already written by prior attempts is preserved.

---

## 5. Teacher View — Multiple Attempts

- Assignment grid shows the latest submission score (standard behaviour, no special-casing).
- The teacher feedback/mark panel shows only the latest submission.
- No attempt limit or cooldown — pupils may redo as many times as they wish.

---

## 6. Migration

Runs as a single numbered SQL migration in `src/migrations/applied/`. This migration is intentional — any existing lesson with a `display-flashcards` activity should automatically have a corresponding `do-flashcards` activity injected so teachers do not need to manually add them, and historical pupil scores are preserved.

### Step 1 — Add `do_activity_id` column to `flashcard_sessions`

```sql
ALTER TABLE flashcard_sessions
  ADD COLUMN do_activity_id text;
```

Nullable — existing sessions (before migration) have no associated `do-flashcards` activity.

### Step 2 — Inject `do-flashcards` activities

For every existing `display-flashcards` activity, insert a new `activities` row:

| Column | Value |
|--------|-------|
| `activity_id` | generated nanoid |
| `lesson_id` | same as source `display-flashcards` |
| `type` | `'do-flashcards'` |
| `title` | `'Do: ' \|\| source.title` |
| `order_by` | `source.order_by + 1` |
| `body_data` | `jsonb_build_object('flashcardActivityId', source.activity_id)` |
| `active` | `true` |
| `is_summative` | `false` |

### Step 3 — Migrate pupil scores

For every **completed** `flashcard_session` linked to a `display-flashcards` activity that was processed in Step 2:

- Insert a `submissions` row:
  - `submission_id` = generated nanoid
  - `activity_id` = the `do-flashcards` activity created in Step 2 for that lesson
  - `user_id` = `flashcard_sessions.pupil_id`
  - `submitted_at` = `flashcard_sessions.completed_at`
  - `body` = `jsonb_build_object('score', correct_count::float / total_cards, 'correctCount', correct_count, 'totalCards', total_cards, 'sessionId', session_id)`
  - `is_flagged` = `false`
- Update `flashcard_sessions.do_activity_id` = the new `do-flashcards` activity id

Sessions where `total_cards = 0` or `status != 'completed'` are explicitly excluded via `WHERE total_cards > 0 AND status = 'completed'` — not via NULLIF (which would insert a NULL-score row rather than skip).

---

## 7. Out of Scope

- No changes to `display-flashcards` activity UI or content editor.
- No changes to `flashcard_attempts` table.
- No changes to flashcard monitor pages (`/flashcard-monitor`).
- `do-flashcards` surfaces through standard assignment/progress views, not the flashcard monitor.
- No per-criterion success criteria scoring for `do-flashcards` in this iteration.
