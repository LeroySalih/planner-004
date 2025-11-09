# AI Marking Webhook Plan

## Scope & Assumptions
- Webhook endpoint: `POST /webhooks/ai-mark`.
- Only short-text assignments are currently in scope, but design should easily extend to other activity types later.
- Requests must include `Authorization: Bearer <token>` and the token must match `process.env.AI_MARK_SERVICE_KEY`.
- Payload structure follows the format provided (top-level `dataSent`, `group_assignment_id`, `activity_id`, `results` array).

## Plan
1. **Authenticate Request**
   - Parse `Authorization` header, ensure it’s a Bearer token.
   - Compare token to `AI_MARK_SERVICE_KEY`; reject with 401 if missing or mismatched.
   - Log auth failures with minimal detail.

2. **Validate & Normalise Payload**
   - Add a Zod schema that captures the payload shape, including nested `dataSent` object and `results` entries (`pupilid`, `score`, `feedback`).
   - Validate `group_assignment_id` matches the `groupId__lessonId` format already used elsewhere (reuse existing helper if available).
   - Ensure `activity_id` and all `pupilid` values are valid UUID strings to avoid malformed writes.
   - Prepare for future activity types by allowing optional additional fields without failing validation.

3. **Resolve Assignment Context**
   - Derive `assignmentId`, `groupId`, and `lessonId` from `group_assignment_id` using the same helper as `readAssignmentResultsAction`.
   - Load the relevant activity metadata (type, lesson) via Supabase.
   - Guard: if activity is not short-text, log and skip (for now) while returning 202 so callers know the webhook was accepted but ignored.

4. **Load Target Submissions**
   - Query Supabase `submissions` for the specific `activity_id` and pupils appearing in the `results`.
   - For pupils without existing submissions, create placeholder submissions referencing the assignment/activity so feedback can be stored.
   - Cache success criteria IDs for the activity to ensure score distributions stay consistent.

5. **Apply AI Feedback & Scores**
   - For each result:
     - Update (or create) the submission body, setting `ai_model_score` and `teacher_feedback` (auto-marking feedback uses the existing teacher-feedback field) plus derived `success_criteria_scores`.
     - Preserve existing teacher overrides; if a teacher override exists, do not overwrite it—only update AI values.
   - Batch updates/inserts where possible to minimise Supabase round-trips.

6. **Trigger Revalidation / Notifications**
   - After updates, revalidate affected result pages (`/results/assignments/[assignmentId]`) so UI reflects new feedback.
   - Emit structured logs (include assignment/activity IDs) for observability.

7. **Respond to Caller**
   - Return `200` with summary counts (updated, skipped, errors).
   - On validation failure, return `400` with message; on unexpected errors, log and respond `500`.

8. **Future-Proofing Considerations**
   - Encapsulate activity-type-specific logic so additional activity types can plug in later.
   - Consider queuing long-running updates if future payloads grow large; for now, keep synchronous.
