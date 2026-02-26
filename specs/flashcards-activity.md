# Flashcards Activity (`display-flashcards`)

## Overview

A fill-in-the-blank flashcard system for vocabulary practice. Teachers write sentences with **bold** answer words. Pupils type the missing word, scored using Levenshtein similarity for flexible spelling. Sessions are tracked per-activity (not per-lesson).

Replaces the previous `display-key-terms` activity type which used markdown tables and multiple-choice quizzes.

---

## Activity Type: `display-flashcards`

### Category

Non-scorable. No teacher marking. `is_summative` must be `false`.

### Teacher Configuration

When creating this activity, the teacher provides:

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | Yes | Display title (e.g. "Key Vocabulary") |
| `lines` | `string` | Yes | Flashcard sentences, one per line. Each sentence must contain exactly one **bold** word (the answer). |

### `body_data` structure

```json
{
  "lines": "An **algorithm** is a step-by-step set of instructions.\nA **variable** stores a value in memory."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `lines` | `string` | Yes | Newline-separated sentences. Bold markers (`**word**`) denote the answer word. Lines without bold markers are ignored. |

### Sentence Format

Each line is a complete sentence with one bold-marked answer word:

```
An **algorithm** is a step-by-step set of instructions.
A **variable** stores a value in memory.
The **CPU** processes instructions in a computer.
```

The parser extracts three fields per line:
- `sentence`: the original line (e.g. `An **algorithm** is a step-by-step set of instructions.`)
- `answer`: the bold word (e.g. `algorithm`)
- `template`: the sentence with the answer replaced by `[...]` (e.g. `An [...] is a step-by-step set of instructions.`)

### Minimum Cards

A flashcard session requires at least 4 parsed cards. Activities with fewer than 4 valid sentences display a message instead of starting a session.

---

## Pupil Interaction

### Session Flow

1. Pupil selects a unit, then clicks a flashcard activity from the sidebar (activities are grouped by lesson).
2. Cards are shuffled into a pile. The top card's template sentence is shown with `[...]` as a gap.
3. Pupil types the missing word into a text input and submits (button or Enter key).
4. Similarity scoring determines correctness:
   - **Exact match** (case-insensitive): green feedback, "Correct!"
   - **Close match** (similarity >= 0.85): green feedback, "Close enough! Check spelling: **[correct answer]**"
   - **Incorrect** (similarity < 0.85): red feedback, "Incorrect. The answer is: **[correct answer]**"
5. After 1.2s feedback delay, the pile advances:
   - **Correct**: card moves to back of pile, consecutive-correct counter increments.
   - **Incorrect**: card moves to position 2 in pile, consecutive-correct counter resets to 0.
6. A "clean pass" (all cards correct consecutively) completes the session.
7. Pupil can restart for additional practice.

### Similarity Scoring

Uses Levenshtein distance normalized by max string length, case-insensitive:

```
similarity(a, b) = 1 - levenshteinDistance(lower(a), lower(b)) / max(len(a), len(b))
```

Threshold: `0.85` (exported as `SIMILARITY_THRESHOLD` from `src/lib/flashcards/similarity.ts`).

---

## Database Schema

### `flashcard_sessions`

| Column | Type | Default | Description |
|---|---|---|---|
| `session_id` | `text` | `gen_random_uuid()` | Primary key |
| `pupil_id` | `text` | -- | The pupil who started the session |
| `activity_id` | `text` | -- | The `display-flashcards` activity being practised |
| `total_cards` | `integer` | -- | Number of cards in the deck |
| `correct_count` | `integer` | `null` | Number of correct answers (set on completion) |
| `status` | `text` | `'in_progress'` | `in_progress` or `completed` |
| `started_at` | `timestamptz` | `now()` | Session start time |
| `completed_at` | `timestamptz` | `null` | Session completion time |

Index: `idx_flashcard_sessions_activity_id` on `activity_id`.

### `flashcard_attempts`

| Column | Type | Description |
|---|---|---|
| `attempt_id` | `text` | Primary key |
| `session_id` | `text` | FK to `flashcard_sessions` |
| `term` | `text` | The template sentence (with `[...]`) |
| `definition` | `text` | The correct answer word |
| `chosen_definition` | `text` | What the pupil typed |
| `is_correct` | `boolean` | Whether the attempt was accepted |
| `attempt_number` | `integer` | Attempt count for this card in this session |
| `attempted_at` | `timestamptz` | When the attempt was made |

---

## Server Actions

All actions in `src/lib/server-actions/flashcards.ts`:

| Action | Parameters | Returns | Description |
|---|---|---|---|
| `readFlashcardsBootstrapAction` | `pupilId` | `{ subjects, flashcardActivities[] }` | Returns pupil's unit structure + all `display-flashcards` activities they can access |
| `readFlashcardDeckAction` | `activityId` | `{ activityId, activityTitle, lessonTitle, cards[] }` | Parses a single activity's sentences into flashcards |
| `startFlashcardSessionAction` | `activityId, totalCards, pupilId` | `{ sessionId }` | Creates a new session row, emits SSE `flashcard.start` |
| `recordFlashcardAttemptAction` | `{ sessionId, term, definition, chosenDefinition, isCorrect, attemptNumber, progress? }` | `{ success }` | Records an attempt, emits SSE `flashcard.progress` |
| `completeFlashcardSessionAction` | `sessionId, correctCount, progress?` | `{ success }` | Marks session completed, emits SSE `flashcard.complete` |

Monitor actions in `src/lib/server-actions/flashcard-monitor.ts`:

| Action | Parameters | Returns | Description |
|---|---|---|---|
| `readFlashcardMonitorGroupsAction` | -- | `{ groups, groupUnits, groupActivities }` | Lists groups with their flashcard activities and units |
| `readLiveFlashcardMonitorAction` | `groupId, activityId` | `{ pupils[], activityTitle }` | Real-time pupil status for a specific activity |
| `readStudyTrackerAction` | `groupId, unitId` | `{ activities[], pupils[], cells[], unitTitle }` | Grid of pupil completion across activities in a unit |
| `readFlashcardSessionDetailAction` | `pupilId, unitId` | `{ pupilName, sessions[] }` | Detailed session history with individual attempts |

---

## SSE Events

Topic: `flashcards`

| Event Type | Payload Fields | Description |
|---|---|---|
| `flashcard.start` | `pupilId, activityId, sessionId, totalCards, status` | Pupil started a new session |
| `flashcard.progress` | `pupilId, activityId, sessionId, consecutiveCorrect, totalCards, status` | Pupil answered a card |
| `flashcard.complete` | `pupilId, activityId, sessionId, consecutiveCorrect, totalCards, status` | Pupil achieved a clean pass |

---

## Routes

### Pupil

| Route | Description |
|---|---|
| `/flashcards?unitId=...&activityId=...` | Flashcard practice page with unit/activity selection |

### Teacher

| Route | Description |
|---|---|
| `/flashcard-monitor` | Group selector for live monitor and study tracker |
| `/flashcard-monitor/live/[groupId]/[activityId]` | Real-time pupil progress for a flashcard activity |
| `/flashcard-monitor/study/[groupId]/[unitId]` | Completion grid: pupils vs activities |
| `/flashcard-monitor/study/[groupId]/[unitId]/[pupilId]/[activityId]` | Session detail drill-down |

---

## File Structure

```
src/lib/flashcards/
├── parse-flashcards.ts     # FlashCard type + parseFlashcardLines()
└── similarity.ts           # levenshteinDistance(), similarity(), SIMILARITY_THRESHOLD

src/components/flashcards/
├── flashcard-card.tsx       # Single card UI (template, input, feedback)
├── flashcard-session.tsx    # Session logic (pile, scoring, progression)
└── flashcards-shell.tsx     # Unit selector, activity sidebar, main area

src/app/(pupil)/flashcards/
└── page.tsx                 # Pupil flashcard page (server component)

src/app/flashcard-monitor/
├── page.tsx                              # Monitor landing (group selector)
├── flashcard-monitor-selector.tsx        # Client component for group/activity/unit selection
├── live/[groupId]/[activityId]/
│   ├── page.tsx                          # Live monitor page
│   └── live-flashcard-monitor.tsx        # SSE-powered real-time view
└── study/[groupId]/[unitId]/
    ├── page.tsx                          # Study tracker page
    ├── study-tracker-grid.tsx            # Pupil x activity grid
    └── [pupilId]/[activityId]/
        ├── page.tsx                      # Session detail page
        └── session-detail-view.tsx       # Session + attempt tables
```

---

## Migration

`src/migrations/applied/063-flashcard-activity-id.sql`:
- Drops `lesson_id` column from `flashcard_sessions`
- Adds `activity_id text NOT NULL` column
- Creates index `idx_flashcard_sessions_activity_id`
