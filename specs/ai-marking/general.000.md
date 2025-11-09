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
- Authentication: `Authorization: Bearer <AI_MARK_SERVICE_KEY>`.

## Processing Steps
1. **Auth & Validation**
   - Reject missing/invalid bearer tokens.
   - Validate payload via Zod; ensure `group_assignment_id` decodes to `groupId` + `lessonId`.
   - For now, only process when `activity_id` resolves to a short-text activity; other types return 202.

2. **Assignment Resolution**
   - Use existing helper to split `group_assignment_id`.
   - Load activity metadata to confirm type and fetch lesson context.

3. **Submissions Handling**
   - Fetch/create submissions per `pupilid`.
   - Preserve existing teacher overrides; AI updates only adjust `ai_model_score`, `teacher_feedback` (used for auto feedback), `is_correct`, and `success_criteria_scores`.
   - If no submission exists, create one with the AI data and mark as AI-generated.

4. **Score & Feedback Updates**
   - Set `ai_model_score = results.score`.
   - Store AI textual feedback inside the existing `teacher_feedback` field (auto feedback lives alongside manual overrides, which always win when present).
   - Recompute derived averages/success criteria using existing helpers.

5. **Response & Revalidation**
   - Return counts for `updated`, `skipped`, `errors`.
   - Trigger `revalidatePath("/results/assignments/[assignmentId]")`.

## Future Considerations
- Extend schema to support MCQ/other activity types.
- Add retry/queueing if webhook payloads become large.
- Capture telemetry + structured logs for monitoring.
