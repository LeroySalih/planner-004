# Plan: Lift SSE Marking State to Page Level

**Date:** 2026-03-17
**Status:** In progress

## Problem

The current approach has each `PupilShortTextActivity` component subscribe to a DOM event and call `router.refresh()` independently. This fails because:

1. `isPendingMarkingRef` must be `true` at the exact moment the SSE event arrives — a timing-dependent guard that breaks easily
2. `router.refresh()` is async and re-renders the entire page, creating flicker and race conditions
3. All "marking complete" events had `isPendingMarkingRef: false` in testing — the guard blocked every real event

## Root Cause of Guard Failure

`isPendingMarkingRef.current = true` is set in `handleSave` success. But if n8n marks the answer faster than expected, or Fast Refresh resets component state, the ref is `false` when the SSE event arrives, blocking `router.refresh()`.

## New Architecture

**State lives in `FeedbackVisibilityProvider`** (already the SSE owner).
**Individual activity components are dumb** — they display props, save to DB locally, and set optimistic local `isPendingMarking` state.

```
SSE event arrives at FeedbackVisibilityProvider
  → stores { score, feedbackText } in markingResults Map (state)
  → context update flows to PupilShortTextActivity via useFeedbackVisibility()
  → component reads markingResult for its activityId
  → merges with prop-based initial state
  → renders updated score/feedback immediately
  → no router.refresh() needed
```

```
Pupil saves answer (component → DB)
  → component sets isPendingMarking = true (optimistic, local)
  → SSE arrives later → context provides markingResult
  → component sees markingResult → sets isPendingMarking = false
```

## Files Changed

### 1. `src/lib/feedback-events.ts`
- Add `score: number | null` and `feedbackText: string | null` to `MarkingCompleteDetail`
- Update `triggerMarkingComplete` and `addMarkingCompleteListener` signatures
- (DOM event kept for future use / other listeners)

### 2. `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug.tsx`
- Add `MarkingResult` type: `{ score: number | null, feedbackText: string | null, receivedAt: string }`
- Add `markingResults: Map<string, MarkingResult>` to `VisibilityState` and context value
- When `assignment.results.updated` SSE arrives:
  - Extract `aiScore`, `aiFeedback`, `activityId`, `pupilId`
  - Store in `markingResults` state
  - Call updated `triggerMarkingComplete` with score/feedback
  - **Verbose log**: full raw SSE payload to console
  - **Verbose log**: markingResults state snapshot after update
- Update `FeedbackVisibilityDebugPanel` to render current marking results

### 3. `src/components/pupil/pupil-short-text-activity.tsx`
- Read `markingResults` from `useFeedbackVisibility()` context
- Compute `effectiveScore`, `effectiveFeedbackText`, `effectiveIsPendingMarking` by merging context result with initial props
- Keep local `isPendingMarking` state — set to `true` after successful save (optimistic)
- When `markingResult` appears in context for this activityId → sync `isPendingMarking` to `false`
- **Remove**: `useEffect` SSE listener, `router.refresh()`, `useRouter` import, `isPendingMarkingRef`
- **Remove**: diagnostic `console.log` from previous debugging session
- **Add**: verbose `console.log` showing effective state (props vs context) on key renders
- DB writes (`saveShortTextAnswerAction`, `toggleSubmissionFlagAction`) stay in the component

## Not Changed
- `page.tsx` — already wraps everything in `FeedbackVisibilityProvider`; no structural changes needed
- `activity-progress-panel.tsx` — receives props as before
- SSE route, n8n webhook, `results-sse.ts` — no changes

## Debug Output (browser console)

After implementation, the console should show:

```
[SSE] assignment.results.updated { activityId, pupilId, aiScore, aiFeedback, ... }
[MarkingResults] state updated { activityId, score, feedbackText, receivedAt }
[PupilShortTextActivity <id>] effective state { fromContext: true, score, feedbackText, isPendingMarking }
```
