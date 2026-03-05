# Flashcard Session Pills Design

Date: 2026-03-04

## Goal

Display the most recent completed session's date and score as colour-coded pills next to each activity in the flashcards sidebar.

## Data Layer

Extend `readFlashcardsBootstrapAction` in `src/lib/server-actions/flashcards.ts` with a second query after the activities fetch:

```sql
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
```

Result is keyed by `activity_id` and returned as part of bootstrap data alongside `flashcardActivities`.

## Types

`FlashcardActivity` gains an optional field:

```ts
lastSession?: { completedAt: string; score: number }
```

`score = correct_count / total_cards` (0–1 float).

## Props

`page.tsx` passes the enriched `flashcardActivities` array (with `lastSession`) to `FlashcardsShell` — no additional props needed.

## UI

Each activity button in the sidebar shows two pills below the title when `lastSession` is present:

- **Date pill**: formatted as DD-MM-YYYY. Green (`bg-green-100 text-green-800`) if within 30 days of today, red (`bg-red-100 text-red-800`) otherwise.
- **Score pill**: formatted as `75%`. Green if `score > 0.8`, red otherwise.
- Pills use `text-xs rounded-full px-2 py-0.5`.
- No pills rendered if `lastSession` is absent.

## Files Changed

- `src/lib/server-actions/flashcards.ts` — add session summary query to bootstrap
- `src/components/flashcards/flashcards-shell.tsx` — render pills in sidebar activity buttons
