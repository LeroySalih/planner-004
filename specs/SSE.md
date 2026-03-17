# Server-Sent Events (SSE) — Data Flow Specification

**Last updated:** 2026-03-17

## Overview

The SSE system provides real-time updates to connected browser clients without polling. It is used for AI marking results, feedback visibility changes, and other live state updates. Events are persisted to the `sse_events` table and broadcast to all connected clients subscribed to the relevant topic.

---

## Architecture

### In-Memory Hub (`src/lib/sse/hub.ts`)

A singleton stored on `globalThis.__plannerSseHub`. Maintains a `Set<SseClient>`, where each client has:
- `id` — random UUID
- `topics` — `Set<SseTopic>` of subscribed topics
- `controller` — `ReadableStreamDefaultController` for pushing chunks

**Important:** The hub is in-process memory. With PM2 cluster mode (multiple processes), clients on different processes will not receive events emitted from another process. The app should run in fork mode (single process) for SSE to work correctly.

### Topics (`src/lib/sse/types.ts` / `src/lib/sse/topics.ts`)

Available topics and their helper functions:

| Topic | Helper | Used for |
|-------|--------|----------|
| `assignments` | `emitAssignmentEvent` | AI marking results, feedback visibility |
| `submissions` | `emitSubmissionEvent` | Submission saved/updated events |
| `feedback` | `emitFeedbackEvent` | Feedback lifecycle |
| `lessons` | `emitLessonEvent` | Lesson state changes |
| `uploads` | `emitUploadEvent` | File upload progress |
| `units` | `emitUnitEvent` | Unit updates |
| `fast-ui` | `emitFastUiEvent` | Prototype rapid-feedback pattern |
| `flashcards` | `emitFlashcardEvent` | Flashcard session events |

### Event Persistence (`src/lib/sse/persistence.ts`)

Every emitted event is written to `sse_events` before broadcast. On reconnect, the SSE route replays recent events for the requested topics.

**Replay exclusions:** `REPLAY_EXCLUDED_TYPES = ["assignment.results.updated"]`
AI marking results are excluded from replay. Replaying historical marking events from multiple n8n retries would corrupt client state. On page load, the server render is authoritative for initial scores.

### SSE Route (`src/app/sse/route.ts`)

```
GET /sse?topics=<comma-separated-topics>
```

- Requires authentication (`requireAuthenticatedProfile`)
- Parses requested topics, defaults to all topics if none specified
- Replays recent events (excluding `REPLAY_EXCLUDED_TYPES`)
- Registers client in hub; streams events via `ReadableStream`
- Keep-alive ping every 25 seconds

---

## AI Marking Flow (Primary Use Case)

### End-to-End Flow

```
Pupil saves answer
  → saveShortTextAnswerAction (server action)
    → DB: update submissions SET body = {answer, ai_model_score: null, ...}
    → DB: delete from pupil_activity_feedback WHERE source = 'ai'
    → DB: upsert ai_marking_queue (debounce 10s)
    → setTimeout(10s): POST /api/marking/process-queue
  → Client: setIsPendingMarking(true) [optimistic]

Queue processor (POST /api/marking/process-queue)
  → Claims pending tasks from ai_marking_queue
  → For each task: reads submission + activity from DB
  → Calls n8n via POST N8N_MARKING_WEBHOOK_URL
    → Sends: { question, model_answer, pupil_answer, webhook_url, activity_id, pupil_id, submission_id, group_assignment_id }

n8n workflow (async)
  → AI evaluates answer
  → POSTs results to webhook_url (/webhooks/ai-mark)

Webhook handler (POST /webhooks/ai-mark)
  → Auth: mark-service-key header checked against MARK_SERVICE_KEY
  → Validates payload: { group_assignment_id, activity_id, results: [{pupilId, score, feedback}] }
  → For each result:
    → DB: update submissions SET body = {ai_model_score, ai_model_feedback, ...}
    → DB: insert into pupil_activity_feedback (source='ai', score, feedback_text)
    → DB: update ai_marking_queue SET status='completed'
  → emitAssignmentEvent("assignment.results.updated", { assignmentId, submissionId, pupilId, activityId, aiScore, aiFeedback, successCriteriaScores })
    → persisted to sse_events
    → broadcast to all clients subscribed to "assignments" topic

Browser (FeedbackVisibilityProvider)
  → Receives SSE message: { topic: "assignments", type: "assignment.results.updated", payload: { activityId, pupilId, aiScore, aiFeedback, ... } }
  → setMarkingResults(prev => new Map(prev).set(activityId, { score, feedbackText, receivedAt }))
  → triggerMarkingComplete(activityId, pupilId, score, feedbackText) [DOM custom event]

PupilShortTextActivity component
  → const contextResult = markingResults.get(activity.activity_id)
  → effectiveScoreLabel = contextResult ? Math.round(score*100)+"%" : scoreLabelProp
  → effectiveFeedbackText = contextResult ? contextResult.feedbackText : feedbackTextProp
  → useEffect([contextResult]): setIsPendingMarking(false)
  → ActivityProgressPanel re-renders with new score/feedback
```

### State Transitions (Component Level)

| State | `isPendingMarking` | `contextResult` | `scoreLabel` | Panel shows |
|-------|--------------------|-----------------|--------------|-------------|
| No submission | `false` | — | "—" | "Your teacher will release..." |
| Saved, awaiting mark | `true` | — | depends | "Your answer is being marked..." |
| Marked (SSE arrived) | `false` | present | "85%" | Score if feedback visible |
| Marked (page refresh) | `false` | — | "85%" (from props) | Score if feedback visible |

### Score Visibility

Scores are gated by `currentVisible` from `FeedbackVisibilityProvider`. The `ActivityProgressPanel` only shows `scoreLabel` and `feedbackText` when:
- `currentVisible = true` (teacher released feedback for the assignment), AND
- `isMarked = true` (score is available), AND
- `!isPendingMarking` (not currently awaiting new mark)

---

## Feedback Visibility Flow

When a teacher toggles feedback visibility for an assignment:

```
Teacher toggles visibility
  → publishAssignmentFeedbackVisibilityUpdate({ assignmentId, feedbackVisible: true/false })
  → emitAssignmentEvent("assignment.feedback.visibility", { assignmentId, feedbackVisible })
  → Persisted + broadcast

Browser (FeedbackVisibilityProvider)
  → Receives message: { type: "assignment.feedback.visibility", payload: { assignmentId, feedbackVisible } }
  → Checks if assignmentId is in this page's channels[]
  → setCurrentVisible(feedbackVisible)
  → ActivityProgressPanel shows/hides results accordingly
```

---

## Event Envelope Format

All SSE messages are sent as:

```
id: <uuid>
data: {"id":"<uuid>","createdAt":"<iso>","topic":"assignments","type":"assignment.results.updated","payload":{...},"emittedBy":null}

```

The `payload` field contains the raw event data specific to each event type.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/sse/hub.ts` | In-memory hub, `emitSseEvent`, `registerSseClient` |
| `src/lib/sse/persistence.ts` | DB persistence, replay fetch, `REPLAY_EXCLUDED_TYPES` |
| `src/lib/sse/topics.ts` | Topic-scoped emit helpers |
| `src/lib/sse/types.ts` | `SseTopic`, `SseEventEnvelope`, `SseEmitInput` |
| `src/lib/results-sse.ts` | `publishAssignmentResultsEvents`, `publishAssignmentFeedbackVisibilityUpdate` |
| `src/app/sse/route.ts` | GET /sse — authentication, replay, streaming |
| `src/app/webhooks/ai-mark/route.ts` | POST /webhooks/ai-mark — n8n callback, updates DB, emits SSE |
| `src/lib/ai/marking-queue.ts` | Queue management, processor, `enqueueMarkingTasks`, `triggerQueueProcessor` |
| `src/app/api/marking/process-queue/route.ts` | POST /api/marking/process-queue — internal trigger |
| `src/app/pupil-lessons/.../feedback-visibility-debug.tsx` | `FeedbackVisibilityProvider` — SSE client, `markingResults` state |
| `src/components/pupil/pupil-short-text-activity.tsx` | Reads `markingResults` context, manages `isPendingMarking` |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `N8N_MARKING_WEBHOOK_URL` | n8n workflow trigger URL |
| `N8N_MARKING_AUTH` | Auth key sent to n8n as `x-marking-key` header |
| `AI_MARKING_CALLBACK_URL` | This app's base URL (e.g. `https://dino.mr-salih.org`) — used to construct n8n callback URL (`/webhooks/ai-mark`) and queue processor URL (`/api/marking/process-queue`) |
| `MARK_SERVICE_KEY` | Auth key expected in `mark-service-key` header from n8n callback |
| `MARKING_QUEUE_SECRET` | Bearer token for internal `/api/marking/process-queue` route |

---

## Debugging

### Browser Console Logs (enabled by default)

```
[FeedbackVisibilityProvider] Connecting SSE... [assignmentId]
[SSE] raw message received { topic, type, payload }
[SSE] assignment.results.updated { activityId, pupilId, aiScore, aiFeedback }
[MarkingResults] state updated { activityId, score, feedbackText, receivedAt }
[MarkingResults] full map after update { ... }
[PupilShortTextActivity <id>] answer saved — isPendingMarking set to true (optimistic)
[PupilShortTextActivity <id>] context result received — clearing isPendingMarking
[PupilShortTextActivity <id>] effective state { fromContext, scoreLabel, feedbackText, isPendingMarking }
```

### DB Logs

Query `ai_marking_logs` table for queue processor activity:
```sql
SELECT created_at, level, message, metadata
FROM ai_marking_logs
ORDER BY created_at DESC
LIMIT 50;
```
