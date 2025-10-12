# Short Text Question Activity Plan (v1.1)

## 1. Data & Type Safety
- Extend `src/types/index.ts` with `ShortTextQuestionActivitySchema` enforcing `questionRichText` and `modelAnswer` as required fields, plus optional settings like `aiModel` if needed later.
- Define `ShortTextSubmissionSchema` with `answer`, `aiModelScore`, `teacherOverrideScore`, and derived `isCorrect` (computed using fixed threshold `score >= 0.8`).
- Update discriminated unions for activity bodies and lesson activities so `"short-text"` flows through existing normalization utilities (`src/lib/server-actions/lesson-activities.ts`, `src/components/lessons/activity-view/utils.ts`).
- Codify the submission body contract as `{ answer: string, aiModelScore?: number, teacherOverrideScore?: number, isCorrect: boolean }`; document this in the plan and ensure Supabase JSON handling matches.

## 2. Server Actions & Supabase Integration
- Create dedicated server actions (e.g., `src/lib/server-actions/short-text.ts`) to load/update activity configs, fetch pupil submissions, trigger AI scoring, and persist overrides.
- Ensure all actions guard access with `requireTeacherProfile` or `requireAuthenticatedProfile` depending on caller context.
- Implement a batch evaluation action `markShortTextActivity` invoked from the teacher feedback panel; it should gather pending submissions for the activity, call the AI scorer once, and write back scores atomically.
- Re-export all new actions via `src/lib/server-updates.ts`.
- Verify RLS policies permit teachers to read all submissions for their class and pupils to upsert their own raw answers before marking.

## 3. Authoring (Edit Mode)
- Update the lesson authoring UI to render `<ShortTextEditor>` when `activity.type === "short-text"`.
- Build the editor with:
  - Rich text input (with bold/italic/justify/code) for the question prompt.
  - Required single-line input for the model answer; validation must block saves until populated.
  - Integration with optimistic `updateLessonActivityAction`, surfacing validation errors in-line.

## 4. Teacher Feedback & Marking Workflow
- Enhance the teacher feedback panel to display Short Text activities with:
  - A `Mark work` button that triggers the batch AI evaluation action.
  - Progress indicators while marking is in flight and per-pupil statuses once scores arrive.
  - Controls to override individual scores, updating `teacherOverrideScore` and recomputing `isCorrect`.
- Persist overrides immediately and reflect them in any aggregated views (e.g., lesson dashboards).
- Log or surface errors if AI marking fails so teachers can retry.

## 5. Pupil Experience (Present Mode)
- Create `PupilShortTextActivity` to render the question, capture the pupil’s answer, and save it without triggering AI evaluation.
- Persist draft answers (on blur or explicit save) via a submission upsert that omits AI scoring fields; mark submissions as `isCorrect = false` until evaluated.
- Display a neutral status (e.g., “Awaiting marking”) so pupils know evaluation happens later; respect lesson locks or completion rules consistent with other activities.
- Pre-populate previously saved answers when pupils revisit the activity.

## 6. AI Scoring Pipeline
- Build `src/lib/ai/short-text-scoring.ts` (or similar) that accepts arrays of `{ question, modelAnswer, pupilAnswer }`, composes the GPT-5 mini prompt, and returns per-pupil scores.
- Handle batching so the teacher-triggered evaluation sends a single request yet maps individual scores back to submissions; include retry/backoff and clear error reporting.
- Ensure scores are clamped between 0 and 1, compute `isCorrect` using the fixed `>= 0.8` threshold, and store timestamps for auditing if required.

## 7. Testing & Documentation
- Add Playwright coverage for teacher marking flow (happy path + override) and pupil answering experience (`tests/activities/short-text.spec.ts`).
- Where feasible, create integration or contract tests for the AI scoring helper (mocking network calls) to validate batching logic.
- Update `specs/activities-short.md` change log and `Planner Agents Playbook` with the new workflow details once implemented.
- Run `npm run lint` and targeted Playwright specs prior to delivery.

## Open Questions
- Should the batch “Mark work” request include only unanswered submissions or re-score previously marked answers as well?
- How should the UI convey partial failures if some pupil evaluations succeed and others fail in the batch response?
- Do we need throttling/rate limits on repeated `Mark work` clicks to prevent excessive AI calls?
