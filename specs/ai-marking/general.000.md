# AI Marking Specification — Short-Text Activities

## Scope
- Applies to short-text assignment activities evaluated by the AI marking service.
- Webhook endpoint: `POST /webhooks/ai-mark`.
- Incoming payload structure matches:
  ```json
  {
    "dataSent": {
      "group_assignment_id": "group__lesson",
      "activity_id": "uuid",
      "question": "string",
      "model_answer": "string",
      "pupil_answers": [{ "pupilid": "uuid", "answer": "string" }, ...]
    },
    "group_assignment_id": "group__lesson",
    "activity_id": "uuid",
    "results": [
      { "pupilid": "uuid", "score": 0.0-1.0, "feedback": "string" },
      ...
    ]
  }
  ```
- Authentication: `mark-service-key: <AI_MARK_SERVICE_KEY>` header.

## Processing Steps
1. **Auth & Validation**
   - Reject requests without a valid `mark-service-key` header.
   - Validate payload via Zod; ensure `group_assignment_id` decodes to `groupId` + `lessonId`.
   - For now, only process when `activity_id` resolves to a short-text activity; other types return 202.

2. **Assignment Resolution**
   - Use existing helper to split `group_assignment_id`.
   - Load activity metadata to confirm type and fetch lesson context.

3. **Feedback & Submissions Handling**
   - Process submissions on a per-pupil basis: when a pupil finishes a quiz, queue only that pupil’s activities that require AI marking.
   - Fetch/create submissions per `pupilid`.
   - All feedback (teacher, auto, or AI) must be written to the shared `pupil_activity_feedback` table with columns: `feedback_id`, `activity_id`, `pupil_id`, `source` (`"teacher" | "auto" | "ai"`), `score`, `feedback_text`, `created_at`.
   - When AI feedback arrives, insert a new row in that table (`source = "ai"`) alongside any existing manual entries; teacher overrides continue to win when calculating the effective score.
   - The UI queries this table for the latest entry per pupil/activity to decide which score and feedback to render.
   - Submissions keep `ai_model_score`/`success_criteria_scores` in sync, but the canonical feedback text now lives in the shared table.

4. **Score & Feedback Updates**
   - Set `ai_model_score = results.score`.
   - Insert/update rows in `pupil_activity_feedback` rather than mutating `teacher_feedback`; downstream consumers read the newest feedback entry for the authoritative text + score.
   - Recompute derived averages/success criteria using existing helpers so aggregates stay in sync with the chosen score.

5. **Response & Revalidation**
   - Return counts for `updated`, `skipped`, `errors`.
   - Always trigger `revalidatePath("/results/assignments/[assignmentId]")`, even when some entries fail, so the UI reflects partial updates promptly.

## Future Considerations
- Extend schema to support MCQ/other activity types.
- Add retry/queueing if webhook payloads become large.
- Capture telemetry + structured logs for monitoring.
