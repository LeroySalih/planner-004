# Do Flashcards Activity — Design Spec

**Date:** 2026-03-18
**Status:** Approved

---

## Overview

Introduce a new `do-flashcards` scorable activity type that allows teachers to assign flashcard practice as a graded activity within a lesson. The pupil completes the flashcard set inside a modal dialog using the existing flashcard engine, and their score is recorded progressively in the standard `submissions` table — giving the activity full parity with all other scorable activity types.

Existing `display-flashcards` functionality is unchanged.

---

## 1. Activity Type & Data Model

### Activity type registration

`do-flashcards` is added to `SCORABLE_ACTIVITY_TYPES` in `src/dino.config.ts`.

### `activities.body_data` shape

```json
{
  "flashcardActivityId": "act_abc123"
}
```

`flashcardActivityId` references the `activity_id` of a `display-flashcards` activity in the same unit. This is the card deck the pupil will practise.

### Submission body shape

```json
{
  "score": 0.75,
  "correctCount": 9,
  "totalCards": 12,
  "sessionId": "sess_xyz"
}
```

- `score` is a 0–1 decimal (`correctCount / totalCards`), compatible with `compute_submission_base_score` via the `score` field — no SQL changes required.
- `sessionId` links back to `flashcard_sessions` for full attempt history.

### Multiple attempts

Each flashcard session produces one `submissions` row. Assignment grid and lesson progress display the latest `submitted_at`. Full session history remains accessible via `flashcard_sessions` and `flashcard_attempts`.

---

## 2. Score Update Flow

Score is written progressively so no progress is lost if the modal is closed mid-session:

1. Pupil opens modal → `startFlashcardSessionAction()` creates a `flashcard_sessions` row and upserts an initial `submissions` row with `score: 0`.
2. Each card attempt → `recordFlashcardAttemptAction()` upserts the submission with the current running score (`correctSoFar / totalCards`).
3. Pupil closes modal (at any point) → `completeFlashcardSessionAction()` marks the session complete and performs a final upsert with the definitive score.
4. Lesson page reflects the new score immediately via optimistic update.

The upsert key is `(activity_id, user_id, session_id)` — one submission row per session.

---

## 3. Teacher UI

### Configuring a `do-flashcards` activity

In the lesson sidebar activity configuration panel, a `do-flashcards` activity shows a single **"Flashcard set"** dropdown. The dropdown is populated with all `display-flashcards` activities from the same unit, identified by title.

- Selecting a set saves `flashcardActivityId` to `body_data`.
- If the unit has no `display-flashcards` activities, the dropdown shows: *"No flashcard sets in this unit — add a Flashcards activity first."*

### Adding the activity type

`do-flashcards` appears as **"Do Flashcards"** in the lesson activity type selector alongside existing types.

### No changes to `display-flashcards`

The existing flashcard content editor is untouched.

---

## 4. Pupil UI

### Activity card

The `do-flashcards` activity renders in the lesson view like all other activities. If the pupil has a prior submission, their latest score is shown as a percentage. A **"Start Flashcards"** button is present.

### Modal dialog

- Clicking "Start Flashcards" opens a large modal containing the existing `FlashcardSession` component, loaded with the card deck from the linked `display-flashcards` activity.
- Ordering, scoring, and feedback mechanics are identical to the current flashcard experience — no changes to `FlashcardSession`.
- A visible close button allows the pupil to exit at any time.
- On close, the modal dismisses and the activity card updates to reflect the new score.

---

## 5. Migration

Runs as a single numbered SQL migration in `src/migrations/applied/`.

### Step 1 — Inject `do-flashcards` activities

For every existing `display-flashcards` activity:

- Insert a new `activities` row:
  - `type = 'do-flashcards'`
  - `lesson_id` = same as source
  - `title` = `'Do: ' || source.title`
  - `order_by` = source `order_by + 1`
  - `body_data = jsonb_build_object('flashcardActivityId', source.activity_id)`
  - `active = true`

### Step 2 — Migrate pupil scores

For every **completed** `flashcard_session` linked to a `display-flashcards` activity:

- Insert a `submissions` row:
  - `activity_id` = the newly created `do-flashcards` activity for that lesson
  - `user_id` = `flashcard_sessions.pupil_id`
  - `submitted_at` = `flashcard_sessions.completed_at`
  - `body` = `{ "score": correct_count::float / total_cards, "correctCount": correct_count, "totalCards": total_cards, "sessionId": session_id }`

In-progress sessions (never completed) are skipped.

---

## 6. Out of Scope

- No changes to `display-flashcards` activity or its existing UI, server actions, or monitoring views.
- No changes to `flashcard_sessions` or `flashcard_attempts` tables.
- No changes to the flashcard monitoring pages (`/flashcard-monitor`).
- `do-flashcards` is not included in the flashcard monitor — it surfaces through the standard assignment/progress views like all other scorable activities.
