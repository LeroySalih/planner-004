# n8n Workflow: AI Marking — Per-Criterion Contract

**Status:** DINO side is implemented and deployed to the `feature/multi-sc`
branch. **The n8n workflow has NOT been changed** — this document specifies what
it must do. Until it is updated, marking still works but takes the legacy
whole-activity path and no per-criterion marks are written.

The marking workflow lives in the n8n UI, not in this repo, so it cannot be
changed from here.

---

## What changed on the DINO side

An activity with success criteria attached is now sent to n8n **once per
criterion**, not once per submission. A 3-criterion activity produces three
separate calls to the same webhook, each asking the model to assess **one**
criterion.

```
submission
   ├── POST → n8n   (criterion A)  ──▶ callback (criterion A)  ┐
   ├── POST → n8n   (criterion B)  ──▶ callback (criterion B)  ├─▶ gather → score
   └── POST → n8n   (criterion C)  ──▶ callback (criterion C)  ┘
```

DINO gathers the replies and computes the submission score itself. n8n does no
aggregation.

---

## 1. Inbound: dino → n8n

Unchanged webhook (`N8N_MARKING_WEBHOOK_URL`) and auth header (`x-marking-key`).
Four new fields, plus a changed meaning for one existing field:

| Field | Type | Notes |
|---|---|---|
| `success_criteria_id` | string | **New.** The criterion being assessed. Must be echoed back. |
| `sc_type` | `"binary"` \| `"levelled"` | **New.** |
| `sc_description` | string | **New.** The criterion's text. |
| `descriptors` | string[] | **New.** Ascending, lowest first. Empty for binary. |
| `max_marks` | number | **Changed meaning.** Now this *criterion's* ceiling — 1 for binary, n for levelled — NOT the activity's total. |

Existing fields (`question`, `model_answer`, `marking_guidance`,
`pupil_answer`, `webhook_url`, `group_assignment_id`, `activity_id`,
`pupil_id`, `submission_id`) are unchanged.

Activities with **no** criteria send no criterion fields at all, and `max_marks`
keeps its old meaning. That path must keep working exactly as before.

### Example — levelled criterion

```json
{
  "question": "Explain why aluminium is used for drinks cans.",
  "model_answer": "Low density, corrosion resistant, recyclable.",
  "marking_guidance": "Not Set",
  "pupil_answer": "its light and doesnt rust",
  "max_marks": 3,
  "success_criteria_id": "a867cfaf-5614-4897-ae71-f2557fb8d3c0",
  "sc_type": "levelled",
  "sc_description": "I can analyse why a specific material is chosen.",
  "descriptors": [
    "Names a relevant property",
    "Names and explains a relevant property",
    "Explains and evaluates the choice against alternatives"
  ],
  "webhook_url": "https://…/webhooks/ai-mark",
  "group_assignment_id": "…",
  "activity_id": "…",
  "pupil_id": "…",
  "submission_id": "…"
}
```

---

## 2. Prompt requirements

**Assess only the named criterion.** Ignore anything in the answer that speaks
to other criteria — they are assessed by their own calls.

**Binary** (`sc_type: "binary"`): award `0` or `1`.

**Levelled** (`sc_type: "levelled"`): award a whole number from `0` to
`descriptors.length`. Descriptor 1 is the lowest rung, descriptor n the highest.
Award the number of the **highest descriptor fully met**.

**State explicitly that 0 is valid**, and what it means: no descriptor met at
all. Without this the model anchors to the lowest descriptor and never returns
0 — the single most likely failure mode of this design.

**Feedback must be scoped to this criterion only.** It is displayed to pupils
beneath that criterion, not as general feedback on the answer.

---

## 3. Callback: n8n → dino

Unchanged endpoint (`/webhooks/ai-mark`) and auth header (`mark-service-key`).
Each entry in `results` gains one field:

```json
{
  "group_assignment_id": "…",
  "activity_id": "…",
  "results": [
    {
      "pupil_id": "…",
      "success_criteria_id": "a867cfaf-5614-4897-ae71-f2557fb8d3c0",
      "marks_awarded": 2,
      "feedback": "You named and explained a property but did not compare it to alternatives."
    }
  ]
}
```

`success_criteria_id` **must** be echoed back verbatim. Without it DINO cannot
tell which criterion the reply belongs to and falls back to the whole-activity
path, silently producing no per-criterion marks.

`marks_awarded` is in **criterion marks** (0..max_marks from the request).
A `score` field is also accepted as a 0–1 fraction of the criterion. DINO
clamps and rounds either form to a whole number in range, so a levelled(3)
criterion can only ever record 0, 1, 2 or 3.

---

## 4. Verifying the change

After updating the flow, mark one submission on a multi-criterion activity and
check:

```sql
-- one row per criterion, real per-criterion variation (not all the same mark)
select success_criteria_id, awarded, available, provenance, left(feedback, 60)
from submission_sc_marks
where submission_id = '<id>';

-- aggregate written once, equal to the sum of the parts
select body::jsonb->>'sc_marks_awarded'   as awarded,
       body::jsonb->>'sc_marks_available' as available,
       body::jsonb->>'ai_model_score'     as normalised,
       mark_status
from submissions where submission_id = '<id>';
```

Signs the flow is not yet echoing the id:
- `submission_sc_marks` has no `provenance='ai'` rows for the submission
- `ai_marking_logs` shows one request per criterion but the callback applied a
  whole-activity mark
- every criterion carries an identical mark (that is the old uniform fill, and
  it should no longer be possible)

---

## 5. Deployment order

No payload versioning was chosen, so requests in flight across a deploy will
fail against the new contract. Drain the queue first:

```sql
select count(*) from external_jobs
 where job_type='ai_mark' and status in ('pending','processing');
```

Wait for zero, deploy DINO, then update the n8n flow. Between those two steps
marking degrades to the whole-activity path — it does not break.
