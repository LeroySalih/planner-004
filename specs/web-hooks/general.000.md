# Webhooks Specification

## `/webhooks/ai-mark`
**Method:** `POST`  
**Purpose:** Receives AI-evaluated short-text marks and feedback for a specific assignment activity, authenticates via bearer token, and updates submissions accordingly.

### Authentication
- Requests must include `Authorization: Bearer <AI_MARK_SERVICE_KEY>`.
- The server rejects missing/invalid tokens with HTTP 401.

### Payload
```json
{
  "group_assignment_id": "group__lesson",
  "activity_id": "uuid",
  "dataSent": {
    "group_assignment_id": "group__lesson",
    "activity_id": "uuid",
    "question": "string",
    "model_answer": "string",
    "pupil_answers": [
      { "pupilid"|"pupilId"|"pupil_id": "uuid", "answer": "string" },
      ...
    ]
  },
  "results": [
    {
      "pupilid"|"pupilId"|"pupil_id": "uuid",
      "score": 0.0-1.0,
      "feedback": "string"
    },
    ...
  ]
}
```
- `group_assignment_id` must match the `groupId__lessonId` pattern already used across `/results`.
- `activity_id` must belong to a short-text activity; other types are accepted but ignored (202).
- `results` entries accept any of `pupilid`, `pupilId`, or `pupil_id`.

### Behaviour
1. Parse headers & payload; reject invalid JSON or schema violations with 400.
2. Load activity metadata; if unsupported, return 202 and skip updates.
3. For each (`activity_id`, `pupilId`) pair:
   - Load or create submissions via Supabase service client.
   - Preserve teacher overrides (scores/feedback) and only update AI fields (`ai_model_score`, `ai_model_feedback`, derived success-criteria scores).
   - Recalculate `is_correct` at the short-text threshold.
4. Track summary counts (`updated`, `created`, `skipped`, `errors`) and revalidate `/results/assignments/[group__lesson]` when no errors occur.
5. Respond with JSON `{ success, updated, created, skipped, errors }`.

### Error Handling
- 400: invalid payload schema.
- 401: auth failure.
- 404: unknown activity.
- 500: internal Supabase or parsing errors (logged to server console).
