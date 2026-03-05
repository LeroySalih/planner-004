# Class Flashcard Monitor — Design

**Date:** 2026-03-05
**Branch:** feature/flashcards-ui
**Status:** Approved

---

## Overview

A real-time teacher dashboard at `/flashcard-monitor/class/[groupId]` showing all pupils in a group and their flashcard session activity. Displays sessions that are currently in-progress or were completed within the last 24 hours. Updates live via SSE.

---

## Route

```
/flashcard-monitor/class/[groupId]
```

Navigated to from a "Class View" link added to the existing `flashcard-monitor-selector.tsx` per group.

---

## Data Layer

### New server action: `readClassFlashcardActivityAction(groupId)`

Located in `src/lib/server-actions/flashcard-monitor.ts`.

Three parallel queries:
1. Group members — pupil ids, first/last names
2. Flashcard sessions for those pupils where `status = 'in_progress'` OR (`status = 'completed'` AND `completed_at > now() - interval '24 hours'`), joined with activity titles
3. Attempt counts per session from `flashcard_attempts`: `SUM(is_correct::int)` as correct, `COUNT(*) - SUM(is_correct::int)` as wrong

Return shape:
```ts
{
  pupils: { pupilId: string; firstName: string; lastName: string }[]
  sessions: {
    sessionId: string
    pupilId: string
    activityId: string
    activityTitle: string
    status: "in_progress" | "completed"
    totalCards: number
    consecutiveCorrect: number
    correctCount: number
    wrongCount: number
    startedAt: string
    completedAt: string | null
  }[]
}
```

### SSE Enhancement

Extend the `progress` parameter accepted by `recordFlashcardAttemptAction` to include:
- `correctCount: number` — cumulative correct answers this session
- `wrongCount: number` — cumulative wrong answers this session

The client (`flashcard-session.tsx`) already tracks `totalCorrectAnswers`. Add a `totalAttempts` counter. Pass both via the `progress` object. The server includes them in the emitted `flashcard.progress` SSE event.

---

## File Structure

```
src/app/flashcard-monitor/class/[groupId]/
├── page.tsx                      # Server component — auth, bootstrap
└── class-flashcard-monitor.tsx   # Client component — SSE, state, render
```

---

## Component Design

### `page.tsx` (server component)
- `requireTeacherProfile()`
- Fetch group name (from existing groups query)
- Call `readClassFlashcardActivityAction(groupId)`
- Render `ClassFlashcardMonitor` with bootstrap data

### `ClassFlashcardMonitor` (client component)

**State:** `Map<sessionId, SessionStats>` initialised from bootstrap.

**SSE events handled:**
| Event | Action |
|---|---|
| `flashcard.start` | Add new session entry for pupil |
| `flashcard.progress` | Update `consecutiveCorrect`, `correctCount`, `wrongCount` |
| `flashcard.complete` | Mark session as completed |

**Render:** Alphabetically sorted pupil list (by last name). Each pupil shows 0–N session mini-cards or "No recent activity".

---

## UI Layout

**Page header:** Group name + "Class Activity" heading. Back link to `/flashcard-monitor`.

**Pupil rows:** Stacked vertically, one per pupil.

**Session mini-card:**
- Header: activity title + status badge (`●` amber = in-progress, `✓` green = completed)
- Body: `✓ N  ✗ N` (correct / wrong counts)
- Footer: progress bar (`consecutiveCorrect / totalCards`) + label `N/N correct in a row` (or "Complete" if done)

**No recent activity state:** Muted text row, still shows pupil name.

---

## Navigation

Add a "Class View" button/link to each group entry in `flashcard-monitor-selector.tsx`, routing to `/flashcard-monitor/class/[groupId]`.
