# UploadCode activity

**Goal:** a teacher sets a programming task and how to grade it; a pupil submits
Python source; the AI marks it and gives feedback **without ever revealing a
working solution**.

## Decisions

- **Pupils paste into a code editor.** Source is stored as text on the
  submission — no file handling, and marking reads it directly.
- **No code execution.** The model reads the source and grades against the
  teacher's guidance. Running untrusted pupil Python would need a sandbox and is
  a different feature.
- **Python by default**, but `language` is a field on the activity body so the
  prompt and highlighter aren't hard-coded to it.
- **Task and submitted source are both syntax highlighted**, server-rendered via
  `highlight.js` so nothing extra has to get past `script-src 'self'`.

## The hard requirement: never leak the solution

Marking feedback must describe *what is wrong and what to consider*, never
working code. This is enforced in two places, because a prompt alone is not a
guarantee:

1. The marking instruction forbids emitting code beyond short illustrative
   fragments naming a construct (e.g. "use a `for` loop"), and forbids
   corrected or completed versions of the pupil's code.
2. `stripSolutionCode()` post-processes the model's feedback and removes fenced
   code blocks over a small line threshold, replacing them with a note. A
   determined model can still leak a one-liner; the threshold catches the case
   that matters — a pasted working answer.

## Touchpoints

| Area | File |
|---|---|
| Type registration | `src/dino.config.ts` |
| Schemas | `src/types/index.ts` |
| Scorer | `src/migrations/086-upload-code-activity-score.sql` |
| Highlighting | `src/lib/code-highlight.ts` |
| Marking prompt | `src/lib/ai/gemini-marking.ts` |
| Queue branch | `src/lib/ai/marking-queue.ts` |
| Markable set | `src/lib/ai/apply-ai-mark.ts` |
| Submission action | `src/lib/server-actions/upload-code.ts` |
| Pupil UI | `src/components/pupil/pupil-upload-code-activity.tsx` |
| Teacher authoring | `src/components/lessons/lesson-activities-manager.tsx` |
| Display / wiring | `src/components/lessons/activity-view/index.tsx`, `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx` |
| Scoring | `src/lib/scoring/activity-scores.ts` |

`compute_submission_base_score` must be taught the new type or every score reads
as null — each AI-marked type has needed this (see migration 075).

## Order

1. Migration + schemas + type registration
2. Highlighting helper
3. Marking: prompt, queue branch, solution stripping
4. Submission action
5. Pupil UI, teacher authoring, wiring
6. End-to-end against the real model
