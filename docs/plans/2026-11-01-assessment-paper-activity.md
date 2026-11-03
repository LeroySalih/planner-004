# Assessment paper activity

Bring assessment papers into the normal DINO flow. A paper becomes an
`assessment-paper` activity in a lesson; pupils' scripts are uploaded over MCP,
redacted, marked inside DINO per question and per success criterion, and the
result reads like any other activity in every report.

The existing `/assessments` module (migrations 104, 113–115, `src/lib/assessments`,
the `*_assessment_paper*` MCP tools, `/assessments`, `/my-assessments`) is left
untouched so we can revert. Folding the existing papers in copies data; it
never moves or deletes it.

## Decisions (agreed with Leroy, 01-11-2026)

- **Raw marks.** The activity's `max_marks` is the sum of its questions. A long
  paper dominates its lesson and unit; no scaling.
- **Absent = 0.** No exemption. The normal progress rule applies.
- **Marking runs inside DINO**, through the `external_jobs` queue, and the model
  only ever receives the redacted script.
- **A question can test several success criteria. Marks are split (Option 1).**
  Each question allots its marks to its criteria (e.g. Q3 = 4 → SC-A 2 + SC-B 2;
  the allocations sum to the question's max). The marker marks each criterion
  within the question out of its allocation; the question's mark is the sum.
- **Old marks** (folded-in papers): the split is unknown, so every criterion on
  the question records the question's own mark (3/4 → A 3/4, B 3/4). The
  question still counts 3/4 once in the total.
- **Host lessons** for the fold-in (by title, in the class's unit):
  | Paper | Host lesson |
  |---|---|
  | 6.1 Graphics - Graphics Assessment 1 | Graphics Assessment 1 (its `source_lesson_id`) |
  | Unit 1 Digital Devices - October Assessment V2 | Assessment 1 - 1 to 5 |
  | Materials - Practice Assessment B | Materials Assessment 1 |
  | Systems Assessment 1 | Assessment 1 (Systems 1) |
  | Isometric Drawing: Curved Block with Cylinder ×3 (8B, 8C, 8D) | Freehand Isometric Shapes Assessment — **one** activity |
  | Unit 1 Digital Devices - Assessment 2 | Assessment 2 (1 Digital Devices) |
- **Question → criteria mapping for the fold-in is proposed, then reviewed by
  Leroy as a table before it is applied.** Where questions can't be told apart,
  the question gets every plausible criterion.

## Data model (migration 132)

```
activity_questions
  question_id uuid pk, activity_id text → activities on delete cascade,
  label text, position int, max_marks int >= 1,
  question_text text null, mark_scheme text null,
  unique (activity_id, label)

activity_question_criteria          -- the split
  question_id uuid → activity_questions on delete cascade,
  success_criteria_id text → success_criteria,
  max_marks int >= 1, position int,
  pk (question_id, success_criteria_id)
  -- invariant (enforced in code): sum(max_marks) = activity_questions.max_marks

submission_question_marks           -- question total, the source of truth
  submission_id text → submissions on delete cascade, question_id uuid,
  awarded int, available int, provenance ai|teacher|legacy, updated_at,
  pk (submission_id, question_id)

submission_question_criterion_marks -- per criterion within a question
  submission_id, question_id, success_criteria_id,
  awarded int, available int,
  why_not_awarded text, how_to_improve text,
  provenance ai|teacher|legacy, updated_at,
  pk (submission_id, question_id, success_criteria_id)

assessment_scripts                  -- one per pupil upload
  script_id uuid pk (opaque; the only id the marker sees),
  activity_id, pupil_id, submission_id,
  original_path text, redacted_paths text[] (page PNGs),
  page_count int, uploaded_at
```

Normal case: the question row = Σ its criterion rows (kept in sync in code).
Legacy case: question row = old mark; each criterion row = the same
awarded/available.

**Aggregation into the rest of DINO** (one function, `recomputeAssessmentSubmission`):
- `submissions.body.marks` = Σ question awarded; `score` = marks / max_marks;
  per-question detail cached in `body.questions` for cheap reads.
- `submission_sc_marks` per criterion = Σ awarded / Σ available of that
  criterion's rows across questions (provenance: teacher if any row is
  teacher, else ai, else legacy).
- `activity_success_criteria` = the union of the questions' criteria, kept in
  sync whenever questions change, so `activity_counts_for_progress` holds.
- `activities.max_marks` = Σ question max.

**Exemptions** — new SQL predicate `is_question_marked_activity_type(type)` (and
TS mirror) so criterion machinery never overwrites question-derived totals:
- `refresh_submission_sc_total` returns early;
- trigger `activity_success_criteria_marks` skips;
- `refresh_criterion_marks` skips rows whose submission is this type;
- `derive-max-marks.ts` excludes it (like matcher/group-items) and gets
  `recalculateAssessmentPaperMaxMarks`.
Check `pupil_activity_scores.criterion_marks` derives from `submission_sc_marks`
so `pupil_criterion_scores` works unchanged.

## Files and redaction

- New bucket `assessment-scripts`. Teacher-only, except a pupil may open their
  own **original** script once the assignment's feedback is visible (mirror
  `pupilMayOpenAssessmentFile`). Never use the `lessons` bucket: any signed-in
  user can read any path there.
- Paths: `{activityId}/paper/{file}` (question paper, mark scheme — teacher only),
  `{activityId}/scripts/{scriptId}/original.pdf`,
  `{activityId}/scripts/{scriptId}/redacted-{n}.png`.
- Redaction regions live in the activity body:
  `redaction: { regions: [{ pages: "first" | "all", x, y, w, h }] }` as
  fractions of the page. Set once by the teacher by drawing on page 1 of the
  question paper (stage 2).
- On upload: `pdftoppm -r 150 -png` (poppler-utils is in the runtime image),
  then `sharp` composites solid black rectangles, writes `redacted-{n}.png`.
  Images (JPEG/PNG) skip the rasterise step. The redacted output is pixels
  only — no text layer survives.
- Uploading without regions set is refused ("Set the name area first").

## Marking

**Superseded by "Marking v2" below.** The per-criterion design in
this section is what stage 4 built; it stays until the replacement lands.

- One `ai_mark` job per (script, criterion), reusing the per-criterion fan-out:
  `enqueueMarkingTasks` gains an `assessment-paper` branch that enqueues one
  job per criterion on the activity with `{ submissionId, successCriteriaId }`.
- The request builder sends: the criterion, the questions that test it with
  each one's allocation, question text and mark-scheme extract; the question
  paper and mark scheme PDFs (document blocks) if attached; the script's
  **redacted** page PNGs, loaded by `script_id`. The builder must never read
  `original_path` — enforce with a single loader that only returns redacted
  paths, and a check that refuses if none exist.
- Response schema: `{ questions: [{ label, awarded, why_not_awarded, how_to_improve }] }`,
  each awarded 0..allocation; prompt states 0 is valid.
- Apply writes `submission_question_criterion_marks` (never overwriting
  `teacher`), then recomputes questions + aggregate. Model route
  `(assessment-paper, NULL)` seeded to Claude Sonnet like the other types; add to
  `AI_MARKED_ACTIVITY_TYPES` so `/admin/ai-models` lists it.

## Marking v2: front sheet, read, then mark per question (agreed with Leroy, 01–02-11-2026)

Replaces the per-criterion jobs and the drawn name area. The slide
https://claude.ai/artifact/EV7thHH6boTCyip6cwyioQ shows the flow.

### 1. Front sheet instead of a name area

- Every paper starts with a **front sheet**: the only place the pupil's name is
  written. Questions start on page 2. The front sheet tells pupils to write
  their name nowhere else.
- The question paper uploaded in setup includes the blank front sheet as its
  page 1.
- On upload, the script's page 1 is kept on the server and **never sent** to a
  model. Pages 2 onwards are rasterised (`pdftoppm -r 150`) and stored as the
  pages marking may use. No black boxes are drawn.
- **Page-1 check, on the server, no model:** compare the script's page 1 with
  the blank front sheet (downscaled greyscale difference via `sharp`, ignoring
  the name box), and the script's page count with the paper's. If either fails
  (scan out of order, a double-sided scan flipping pages, extra or missing
  sheets) the script is held: `mark_status = null`, the reason in `mark_error`,
  shown on the results page, nothing sent. The teacher can fix the order or
  re-upload.
- This replaces `body_data.redaction` regions, the fingerprint and the
  *The name is hidden — allow marking* confirmation. Remove that code when v2
  lands (no backwards-compatibility shims); folded papers are never marked, so
  nothing depends on it.
- `readMarkablePages` (renamed from `readRedactedScriptPages`) stays the single
  loader marking may use, and returns pages 2 onwards only for scripts that
  passed the page-1 check.

### 2. Read: one call per script

- One `ai_read` job per script, on the markable pages. Reply, per question
  label: `{ label, kind: "text" | "sketch" | "mixed", transcription,
  pages: [n], status: "answered" | "blank" | "unreadable" | "continued" }`.
  A sketch is described, not transcribed.
- Pages, not bounding boxes: models place boxes inaccurately.
- Validator: every label on the paper exactly once; pages within range.
- Stored per (submission, question) and shown to the teacher on the results
  page, editable, so a misread mark can be traced.
- `blank` → the question scores 0 with "No answer submitted"; not sent to be
  marked. `unreadable` → marked with all markable pages and flagged for the
  teacher.

### 3. Mark: one call per question per pupil

- One `ai_mark` job per (submission, question), enqueued when the read
  completes, for questions whose marking setting is not *teacher only*.
- The model sees: the question (label, text, max marks), that question's mark
  scheme text, its criteria with each one's allocation, the transcription and
  the pages the answer is on. Not the whole paper.
- One call covers every criterion on the question:
  `{ criteria: [{ success_criteria_id, awarded, why_not_awarded, how_to_improve }] }`,
  each 0..allocation. The validator throws (job retries) if a criterion is
  missing, repeated, unknown or out of range. A marking point is credited to
  one criterion only, and the pupil gets one consistent account.
- `depends_on_question_id` (error carried forward): that question's
  transcription and pages are added, labelled as the earlier answer.
- The prompt states 0 is valid.
- Storage unchanged: `submission_question_criterion_marks`, question row = sum,
  `recomputeAssessmentSubmission`; teacher rows survive a re-mark; completion
  sets `mark_status = 'marked'` under the row lock when no sibling job is open.
- Later, not now: a question whose mark scheme tags each marking point to a
  criterion could be split into one job per criterion; storage already allows it.

### 4. Marking setting per question

- `activity_questions.marking`: `ai` | `ai_check` | `teacher`.
  - `ai`: marked by the model.
  - `ai_check`: marked by the model and listed on the results page for the
    teacher to confirm or change; confirming stamps the rows `teacher`.
  - `teacher`: not sent; the teacher marks it.
- Default `ai`; a question the reader tags `sketch` is treated as `ai_check`
  unless the setting is `teacher`.
- Mark schemes for sketches written as checkable points ("cylinder on the top
  face (1), hidden detail shown (1)"), not "accurate drawing (3)".

### Teacher override per question (agreed with Leroy, 02-11-2026)

- A teacher can override any question's mark on the results page, whatever its
  marking setting. The marks panel lists every question with its mark and, under
  it, each criterion's mark (0..allocation) and comment.
- On a single-criterion question (most), changing the question's mark is
  changing that criterion's mark.
- On a multi-criterion question the teacher changes the criterion marks; the
  question total is their sum and updates as they do.
- Overridden rows are stamped `teacher`, survive a re-read and a re-mark, and
  the teacher's comment replaces the model's (`effectiveQuestionCriterionFeedback`).
  The overall marks, criterion reports and the feedback PDF follow at once.
- Confirming an `ai_check` question without changing it also stamps it `teacher`.

### 5. Per-question mark schemes

`activity_questions.mark_scheme` is empty on most folded papers. A one-off
teacher-triggered step (editor or MCP) asks the model to split the mark scheme
PDF into per-question text for the teacher to review and save. A question with
no mark scheme text is not sent for marking; the reason is shown.

### 6. What the pupil sees (agreed with Leroy, 02-11-2026)

On the pupil's lesson page, the assessment paper activity shows:

| State | Shown |
|---|---|
| Script not uploaded yet | Nothing but the activity title: the question paper stays hidden so pupils cannot read it before the test |
| Script uploaded, feedback off | The question paper |
| Feedback on | The question paper, the overall marks (e.g. 27 / 38), the teacher's overall comment, **Download feedback** and **My script** |

- No per-question table on the page; the detail is in the feedback PDF.
- A folded paper counts as sat when the pupil has a submission on it (most
  have no scripts), so its pupils still see the paper and their marks.
- **My script**: the pupil's own original PDF, front sheet included, through
  the existing script rule in `pupilMayOpenAssessmentPaperFile` (own script, feedback on).
- **Download feedback**: a PDF built on demand at download time, so teacher
  edits are always included. Own submission only, feedback on, same access rule
  as the script. One section per question, in paper order:
  - the question (label, text, max marks);
  - the pupil's answer: the transcription; for a sketch, `mixed` or
    `unreadable` answer, an image of the page(s) it is on;
  - the success criteria the question tests, with marks awarded / allocation;
  - for each mark not awarded, why it was lost and how to improve (teacher
    comments override, as `effectiveQuestionCriterionFeedback` already does);
  - the mark scheme for that question, if the paper's setting allows.
- Per-paper setting `body_data.showMarkSchemeToPupils`, default true. When
  false the PDF leaves the mark scheme out, for papers reused with later
  classes.
- The question paper the pupil sees excludes nothing (it is the blank paper,
  front sheet included); it carries no pupil data.

### Cost

One read call per script plus one small call per marked question (Materials:
18 reads + up to 450 marks). Mark the shared system prompt for prompt caching
where the Anthropic client supports it.

### Accuracy check before switching over

The Materials (18 scripts) and Systems (16 scripts) papers carry Leroy's own
marks as legacy rows. Their scripts predate the front sheet (the name sits on a question page), so
for this test only, mark from the existing redacted pages.
Once Anthropic credit is restored: read and mark both papers on dev into a
scratch copy (never over the legacy rows), compare per-question and total marks
with Leroy's, and report exact agreement, within 1 mark and mean difference.
Sketch-heavy papers need new scripts sat on the front-sheet layout.

### Build order

1. Migration: `activity_questions.marking`, `depends_on_question_id`; a
   per-(submission, question) transcription table; `ai_read` job type.
2. Upload: front-sheet split, page-1 check, hold with reason; remove the name
   area regions, fingerprint and confirmation (editor, actions, queue gates,
   MCP `set_assessment_activity_redaction`).
3. Read job: request, schema, validator, storage, results-page view and edit.
4. Mark job: per-question fan-out, request, schema, validator, apply; remove
   the per-criterion request code.
5. Marking setting and teacher-check list on the results page.
6. Mark scheme split step with teacher review.
7. Pupil view: question paper gated on upload, marks and the two links, the
   feedback PDF generator, the mark-scheme setting; remove the per-question
   pupil view built in stage 5.
8. MCP (`set_assessment_activity_questions` takes `marking`, `depends_on`),
   `docs/MCP.md`, `CLAUDE.md`.
9. The accuracy check above.

## Stages

Each stage: implement, typecheck, test on dev with a tsx script (rolled back or
cleaned up), spec review, then the next stage. No commit until Leroy asks.

1. **Schema + aggregation.** Migration 132 (tables, predicate, exemptions,
   `assessment-scripts` bucket rules if DB-side), `migrate.sh` entry, config
   lists (`SCORABLE_ACTIVITY_TYPES`, `AI_MARKED_ACTIVITY_TYPES`, a new
   `QUESTION_MARKED_ACTIVITY_TYPES`), Zod body schema, store module
   `src/lib/assessment-paper/` (questions CRUD with allocation validation,
   criteria sync, `recomputeAssessmentSubmission`, teacher mark per
   (question, criterion)). Tests: totals, criterion roll-up, legacy rows,
   max_marks, exemptions survive `refresh_activity_criteria`.
2. **Teacher setup in the lesson editor.** Type in `ACTIVITY_TYPES`; editor form
   for questions (label, max, text, mark scheme, criteria + allocation picker
   limited to the lesson's criteria), question paper / mark scheme upload,
   name-area drawing on page 1. Teacher read-only views.
3. **MCP + upload + redaction.** Tools: `get_assessment_activity`,
   `set_assessment_activity_questions`, `set_assessment_activity_redaction`,
   `create_assessment_activity_file_upload_link` (kind: question_paper |
   mark_scheme | script + pupil_id). Script upload → redact → script row →
   submission → enqueue marking. Pupil must be in a class the lesson is
   assigned to (roster rule). Docs in `docs/MCP.md`.
4. **Marking in the queue** as above, with logging, retries, AI queue display.
5. **Views.** Results page sidebar: per-question grid with per-criterion marks
   editable (teacher provenance) and feedback; pupil lesson page: questions,
   marks, feedback, own original script, all behind the assignment's feedback
   switch; MCP `get_pupil_lesson_feedback` includes question detail.
6. **Fold-in.** `scripts/fold-assessment-papers.ts` reading a reviewed mapping
   file: creates the activities (one for the three Isometric papers), questions,
   criteria (old LO → proposed SCs; allocations split evenly, remainder to the
   first), copies paper files and scripts into `assessment-scripts`, creates
   each pupil's submission with legacy question + criterion rows, carries
   went-well/targets into the overall feedback, then recomputes. Run on dev for
   Leroy to evaluate. Checkpoint before it runs: Leroy reviews the mapping
   table (and the name area for papers with scripts).

## Open points to settle in the stages

- Systems Assessment 1: LO2 has no criteria and LO6 is unlinked (9 questions);
  the mapping review decides.
- Whether the old papers' scripts are re-marked through the new pipeline after
  the fold-in (to test it) — Leroy's call at stage 6.
