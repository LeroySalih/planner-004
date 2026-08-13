# Multi-SC Marking — Open Questions

Working document for the `feature/multi-sc` branch. Each question is presented to
the user one at a time; answers are recorded here as they come in.

**Status:** all answered (11 asked, Q4 dissolved by Q2, Q6b added). Ready to turn
into an implementation plan.

## The agreed plan (from the user)

1. Every SC becomes one of two types: **binary** (0 or 1) or **levelled**
   (n ascending descriptors, pupil scores 0..n).
2. SC type and descriptors are sent to the model for assessment. An activity with
   multiple SCs is sent to the model once **per SC** — each call assesses one
   criterion only.
3. When all replies return, the final score is a percentage of marks available,
   applied to `max_marks`. Example: `max_marks = 5`, two binary SCs (1 each) plus
   one 3-level SC → 5 available. Pupil scores 0 + 1 + 2 = 3 → 60% → 3 marks.
4. DINO coordinates the fan-out; n8n executes each individual model call.
   (Recommended and provisionally agreed — see Q9.)

---

## Questions

### Q1 — Is binary/levelled intrinsic to the SC, or set per activity?
An SC row is shared across many activities via `activity_success_criteria`.
Making the type intrinsic means changing it changes every activity using it.

**Answer: Intrinsic to the SC.** A single `sc_type` column on `success_criteria`
(`'binary' | 'levelled'`). The criterion is the same type everywhere it appears;
descriptors are authored once against the SC. No per-activity override.

*Implication:* changing an SC's type retroactively affects every activity using
it — see Q10 for what that means for already-marked work.

### Q2 — What is `max_marks` for once SC marks are derivable?
Available marks can be computed as `Σ(binary=1, levelled=n)`. Does `max_marks`
become derived/read-only, or stay an independent scaling factor?

**Answer: Derived, read-only.** For any activity with SCs attached,
`max_marks = Σ(binary → 1, levelled → n)`, recalculated whenever the SC set or an
SC's descriptors change. The weighted sum of awarded marks *is* the score — no
percentage-and-rescale step.

*Implications:*
- The percentage in the user's point 3 becomes a display/reporting concern only.
- `max_marks` must be recalculated on: activity SC link add/remove, SC type
  change, descriptor add/remove. Recalculation is a write to `activities`.
- Activities with **no** SCs keep the existing manually-set `max_marks` and the
  current whole-activity marking path.
- The activity editor must show `max_marks` as read-only when SCs are attached.

### Q3 — Does a levelled SC with n descriptors score 0..n or 1..n?
i.e. is "achieved nothing" a valid outcome, giving n+1 possible results?

**Answer: 0 to n.** n+1 possible outcomes. `0` = no descriptor met; `n` = top
descriptor met. A levelled SC contributes `n` to marks available. Binary is then
just the n=1 case, which keeps the arithmetic uniform.

*Implication:* the model must be told explicitly that 0 is a valid response and
what it means, or it will anchor to the lowest descriptor.

### Q4 — How are fractional marks handled? — **MOOT**
Resolved by Q2. With `max_marks` derived as the sum of SC weights, awarded marks
are always integers and there is no rescaling step. Percentages remain a display
concern; round for display only, never for storage.

### Q5 — What happens when one SC's marking fails permanently?
Fail the whole submission, or mark it with the SCs that succeeded?

**Answer: Fail the whole submission.** If any SC job exhausts `max_attempts`, set
`submissions.mark_status = 'marking-error'` with the failing criterion named in
`mark_error`. No aggregate score is written.

*Implications:*
- Successful per-SC results are still persisted to `submission_sc_marks`, so a
  retrigger re-runs only the failed criterion rather than paying for all of them
  again.
- The aggregate is computed only when the count of completed SC rows equals the
  activity's SC count — a failure simply means that gate never opens.
- Existing `marking-error` UI and SSE events carry through unchanged.

### Q6 — Which activity types get per-SC marking?
Currently AI-markable: `short-text-question`, `upload-spreadsheet`,
`upload-worksheet`, `mark-worksheet`.

**Answer: all scorable activities.** The SC-based scoring model applies across
`SCORABLE_ACTIVITY_TYPES` (16 types), not just the AI-marked subset.

*Complication:* only 4 of the 16 currently go to a model. The other 12 are scored
deterministically in-app (`multiple-choice-question` via `is_correct`, plus
`matcher`, `sequence`, `group-items`, `do-flashcards`, `text-question`,
`long-text-question`, `upload-file`, `upload-url`, `feedback`, `sketch-render`,
`voice`). There is no model call to fan out for those — so "per-SC" means
something different. See Q6b.

### Q6b — How do deterministically-scored types distribute their score across SCs?
An MCQ produces a single right/wrong. If it has 3 SCs attached, what does each
criterion score?

**Answer: propagate the same result to every attached SC.** The activity's own
deterministic outcome is written to each SC: correct → full marks for that
criterion (binary → 1, levelled → n), incorrect → 0. No model call is made.

*Implications:*
- These types keep their existing in-app scoring path; only the per-SC write is
  added on top.
- Combined with Q2 (derived `max_marks`), an MCQ carrying 1 binary + 1 levelled(3)
  SC has `max_marks = 4`, and a correct answer scores 4/4. Attaching more SCs
  therefore increases an MCQ's weight in any aggregate.
- **Known limitation, accepted:** per-SC data for these types carries no more
  information than the activity score itself — it is uniform fill by design. It
  is meaningful for coverage reporting, not for diagnostic per-criterion
  attainment. This is the behaviour being deliberately removed from *AI* marking
  (`apply-ai-mark.ts:377`), retained deliberately here.

### Q7 — Can a teacher override an individual SC score, or only the final mark?

**Answer: per SC, with the aggregate recomputed.** The teacher edits an individual
criterion's awarded marks; the submission total is recalculated as the sum of its
SC marks. The aggregate is always the sum of its parts — no independent
whole-activity override.

*Implications:*
- `submission_sc_marks` needs to record provenance per row (`ai` vs `teacher`) so
  a re-mark does not silently discard teacher edits.
- Decide re-mark behaviour: teacher-edited rows should be preserved and skipped
  when a submission is re-marked.
- The existing `teacher_override_score` / `teacher_ai_score` path in
  `compute_submission_base_score` needs review — for SC-scored activities the
  authoritative total now comes from the SC rows.
- Marking UI in `assignment-results-dashboard` gains a per-criterion editor.

### Q8 — Where do teachers author the levelled descriptors?
Curriculum builder at `/curriculum/[curriculumId]`, or the activity editor?

**Answer: the curriculum builder**, at `/curriculum/[curriculumId]`, alongside the
SC description. Follows directly from Q1 — type and descriptors are intrinsic to
the SC, so they are authored where SCs are authored.

*Implications:*
- The curriculum builder gains a binary/levelled toggle per SC and an ordered
  descriptor list editor (add, remove, reorder) for levelled ones.
- Editing descriptors changes `max_marks` on every activity using that SC (Q2) —
  the recalculation must be triggered from this surface too, not only from the
  activity editor.
- Server actions in `src/lib/server-actions/curricula.ts` extend to carry
  `sc_type` and descriptors.
- Not shown in the activity editor beyond what is needed to pick an SC.

### Q9 — New n8n flow, or extend the existing `ai-mark` flow?
The callback must now carry `success_criteria_id`.

**Answer: extend the existing flow.** Same n8n webhook, same
`/webhooks/ai-mark` callback route. The request gains `success_criteria_id`,
`sc_type` and `descriptors`; each entry in `results` echoes back
`success_criteria_id`.

*Implications:*
- `ShortTextMarkingParams` in `ai-marking-client.ts` gains the three new fields.
- `ResultEntrySchema` in `apply-ai-mark.ts` gains an optional
  `success_criteria_id`; when present, the result is written to
  `submission_sc_marks` instead of directly to `submissions.body`.
- Existing auth (`mark-service-key`), the `webhook_apply` capture job and retry
  handling all carry over unchanged.
- No payload versioning — accepted risk that jobs in flight across a deploy may
  fail and need a retrigger. Drain the queue before deploying.
- The n8n workflow itself must be updated to include the criterion in its prompt
  and echo the id back. Flow definitions live under `docs/n8n/`.

### Q10 — What happens to submissions already marked under the old scheme?
Their `body.success_criteria_scores` is uniform-filled and meaningless.

**Answer: migrate the uniform fill into `submission_sc_marks`.** A one-off
migration copies each existing `success_criteria_scores` entry into a row in the
new table, so per-criterion reporting has continuous data across the cutover.

*Implications:*
- Migrated values are the old normalised 0–1 scores; they must be converted to
  the new `{ awarded, available }` shape using the SC's type
  (`awarded = round(score × available)`).
- The provenance column already required by Q7 gains a third value: `'legacy'`
  alongside `'ai'` and `'teacher'`. This keeps migrated rows distinguishable from
  genuine per-criterion assessment in reports and in any future audit, at no
  extra cost.
- **Known limitation, accepted:** pre-cutover rows are uniform fill, not real
  per-criterion judgements. Any report that presents them as diagnostic detail
  will be showing derived data. The `'legacy'` marker is what makes that
  recoverable later.
- Aggregate scores on historical submissions are unchanged by the migration.

### Q11 — Is per-SC feedback returned and shown to pupils?
Or is only the aggregate feedback surfaced?

**Answer: per-SC feedback, shown per criterion.** Each criterion displays its own
awarded marks and its own comment, to pupils and teachers alike.

*Implications:*
- `submission_sc_marks.feedback` holds the per-criterion text; the model is asked
  for feedback scoped to that criterion only.
- Pupil-facing activity view and the teacher marking dashboard both need a
  per-criterion breakdown component.
- `insertPupilActivityFeedbackEntry` currently writes one feedback row per
  submission — decide whether it takes the concatenation or one row per criterion.
- Deterministic types (Q6b) have no model feedback to show; their per-SC rows
  carry marks only.

---

## Questions raised during implementation

### Q12 — Backfilling `max_marks` would drop 286 STQs from 3 marks to 1
Short-text-question defaults to `max_marks = 3` but most carry a single binary
criterion, worth 1 mark under the derived model.

**Answer: convert those criteria to levelled(3) first**, with placeholder
descriptors, so the 3-mark ceiling is preserved. Teachers rewrite the
descriptors in the curriculum builder. Implemented in migration `073`.

### Q13 — Those criteria are shared; converting them inflates 132 MCQs to 3 marks
66 criteria are involved but they touch 480 activities, not 286.

**Answer: cap deterministic types at 1 mark.** `DETERMINISTIC_ACTIVITY_TYPES`
(MCQ, matcher, sequence, group-items, do-flashcards) are always worth 1 mark
regardless of criterion weights — a right/wrong activity is one mark however
many criteria it maps to. Non-scorable types are excluded from derivation
entirely; they carry criteria for curriculum mapping only.

*Refines Q6b:* criteria on a deterministic type still receive propagated marks
for coverage reporting, but no longer inflate the activity's weight in an
aggregate.

---

## Decisions log

| # | Question | Decision |
|---|---|---|
| Q1 | SC type scope | Intrinsic to the SC — `sc_type` on `success_criteria` |
| Q2 | `max_marks` | Derived, read-only: `Σ(binary→1, levelled→n)` |
| Q3 | Levelled range | `0..n` — n+1 outcomes, 0 is valid |
| Q4 | Fractional marks | Moot — derived `max_marks` means integers only |
| Q5 | Partial failure | Fail the whole submission; keep succeeded SC rows for retry |
| Q6 | Type coverage | All 16 `SCORABLE_ACTIVITY_TYPES` |
| Q6b | Deterministic types | Propagate the activity's result to every attached SC |
| Q7 | Override | Per SC; aggregate recomputes as the sum |
| Q8 | Authoring | Curriculum builder, `/curriculum/[curriculumId]` |
| Q9 | n8n | Extend the existing flow; no payload versioning |
| Q10 | Existing data | Migrate uniform fill, tagged `provenance='legacy'` |
| Q11 | Feedback | Per-SC feedback shown per criterion |

## Resulting shape

**Schema changes**
- `success_criteria.sc_type text not null default 'binary'`
  (`check (sc_type in ('binary','levelled'))`)
- `success_criteria_descriptors (success_criteria_id, level_index, descriptor)`
  — PK on the first two, FK to `success_criteria`
- `submission_sc_marks (submission_id, success_criteria_id, awarded int,
  available int, feedback text, provenance text, marked_at timestamptz)`
  — PK on the first two, `provenance in ('ai','teacher','legacy')`
- `activities.max_marks` becomes derived for any activity with SCs attached

**Flow**
1. Submission enqueued → DINO fans out one `external_jobs` row per (submission, SC)
   for AI-marked types; deterministic types write SC rows inline.
2. Each job calls the existing n8n flow with the criterion, its type and its
   descriptors.
3. Each callback writes one `submission_sc_marks` row (idempotent upsert), then
   checks completeness under a row lock on the submission.
4. Last one in sums the SC marks, writes the aggregate to `submissions.body`, and
   publishes the SSE event.

**Known limitations, accepted**
- Per-SC data on deterministic types is uniform fill by design (Q6b).
- Pre-cutover migrated rows are derived, not real assessments (Q10) — the
  `'legacy'` provenance marker keeps them identifiable.
- Call volume scales with SC count: a 3-SC activity for 30 pupils is 90 model
  calls, not 30.

**Still to resolve during planning** (mechanical, not decisions)
- Re-mark semantics when some rows are `provenance='teacher'` — preserve and skip.
- Whether `compute_submission_base_score` reads the aggregate from
  `submissions.body` (cheap) or sums `submission_sc_marks` (authoritative).
- Whether `insertPupilActivityFeedbackEntry` writes one row or one per criterion.
