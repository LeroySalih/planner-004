# Plan: Automated AI Marking Flow (v002)

## Objective
Implement an automated marking flow for `short-text-question` activities. When a pupil provides an answer, the system should automatically trigger an AI marking process in the background using a DigitalOcean FaaS function, update the database, and notify teachers in real-time.

## 1. Environment Configuration
Add the following variables to `.env` and production environments:
- `AI_MARKING_URL`: The DigitalOcean FaaS endpoint.
- `AI_MARKING_AUTH`: The Basic authorization header.

## 2. Core Service: `src/lib/ai/ai-marking-service.ts`
Create a new service module to handle the marking lifecycle:
- **Invoke**: Call the DigitalOcean FaaS function with `question`, `model_answer`, and `pupil_answer`.
- **Parse**: Extract `score`, `feedback`, and `reasoning` from the nested JSON response (handling stringified JSON results).
- **Persist**: 
    - Update the `submissions` table (body JSONB) with AI results.
    - Insert a record into `pupil_activity_feedback` table (source: `ai`).
- **Broadcast**: Trigger a real-time SSE update using `publishAssignmentResultsEvents` so the teacher's dashboard reflects the new result immediately.

## 3. Server Action Updates: `src/lib/server-actions/short-text.ts`
- **`saveShortTextAnswerAction`**: 
    - After successfully persisting the pupil's answer to the database, trigger the `ai-marking-service`.
    - Use a "fire and forget" pattern (do not `await` the AI response) to ensure the pupil receives a "Saved" confirmation instantly.
- **`triggerManualAiMarkingAction`**: 
    - Create a new server action allowing teachers to manually trigger or re-run the AI marking for a specific submission.

## 4. Pupil UI: `src/components/pupil/pupil-short-text-activity.tsx`
- **Interactivity**: Ensure the `Input` field is disabled and show a spinner while the `saveShortTextAnswerAction` is pending.
- **Feedback**: Maintain the simple "Saved" message to keep the pupil's view clean and fast.

## 5. Teacher UI: `src/components/assignment-results/assignment-results-dashboard.tsx`
- **Manual Trigger**: Add a "Mark with AI" button in the **Automatic score** tab of the sidebar.
- **SSE Integration**: Ensure the existing SSE architecture correctly receives and applies the AI results to the grid and sidebar in real-time.

## Verification
- **Performance**: Pupil input remains responsive; "Saved" appears quickly.
- **Real-time**: Teacher dashboard updates with AI score/feedback without page refresh.
- **Resilience**: Manual trigger works as a fallback if background processing fails.
