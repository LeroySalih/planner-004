# Plan — Realtime updates from `/webhooks/ai-mark`

## Goal
Ensure AI mark webhook writes trigger Supabase Realtime notifications so `/results/assignments/[group__lesson]` reflects new auto marks immediately, and document the behaviour.

## Steps
1) Confirm expected auth header (`mark-service-key`) and channel naming convention for assignment-scoped realtime (reuse existing results channel schema).
2) Add a realtime publish step in the `/webhooks/ai-mark` handler after successful Supabase writes, carrying `{ submissionId, pupilId, activityId, aiScore, aiFeedback, successCriteriaScores }` on channel `results:assignments:{group__lesson}` (successCriteriaScores mirrors aiScore across all criteria).
3) Keep the handler idempotent: if publish fails, log and fall back to path revalidation without blocking the response.
4) Update specs to match: webhooks auth + realtime emission, results page realtime expectations sourced from this webhook.
5) Test locally by firing the webhook with a valid `mark-service-key` and verifying the results dashboard receives the realtime payload and redraws without manual refresh.
