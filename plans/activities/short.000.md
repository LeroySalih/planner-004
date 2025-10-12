# Short Text Question Activity Plan

## 1. Data & Type Safety
- Audit existing schemas in `src/types/index.ts` for activity bodies and submissions; introduce `ShortTextQuestionActivitySchema` with fields for `questionRichText`, `modelAnswer`, and scoring thresholds.
- Define a `ShortTextSubmissionSchema` covering `answer`, `aiModelScore`, `teacherOverrideScore`, and derived `isCorrect` (threshold-based).
- Extend shared discriminated unions for activity types (e.g., `LessonActivitySchema`, `ActivityBody`) to recognise `"short-text"` and ensure normalization helpers (such as `src/lib/server-actions/lesson-activities.ts` and `src/components/lessons/activity-view/utils.ts`) handle the new body shape.
- Confirm Supabase `submissions.body` already stores JSON; document expected payload contract `{ answer, aiModelScore, teacherOverrideScore, isCorrect }` (note drift from spec’s `answer_chosen` field).

## 2. Server Actions & Supabase Integration
- Add server action helpers (e.g., `src/lib/server-actions/short-text.ts`) that validate inputs, enforce auth via `requireTeacherProfile`/`requireAuthenticatedProfile`, and call Supabase to read/write activity configs and submissions.
- Export new actions via `src/lib/server-updates.ts` and ensure existing pages/components import from the barrel.
- Verify RLS policies allow pupils to insert/update their own submissions with the new body shape; adjust Supabase SQL or migrations if required.

## 3. Authoring (Edit Mode)
- Update the lesson authoring surface (likely `src/components/units/lesson-sidebar.tsx` or equivalent) to render a `<ShortTextEditor>` when `activity.type === "short-text"`.
- Build `ShortTextEditor` component providing:
  - Rich text editor for the prompt with bold/italic/justify/code controls (reuse existing RichText primitives).
  - Single-line text input for the model answer.
  - Inline validation (question required, model answer optional?) before persisting changes.
- Ensure editor integrates with the existing optimistic update flow (`updateLessonActivityAction`) and displays validation feedback consistent with other activity editors.

## 4. Teacher Presentation Modes
- Extend lesson activity presentation components so `"short-text"` supports:
  - **Short mode**: read-only rendering of the question text (sanitized) with an activity badge.
  - **Present mode (teacher)**: show question, model answer, and latest AI score/override for quick review; include status of pending pupil submissions.
- Update any shared mapping (e.g., `src/components/lesson/activity-view/index.tsx`) to route to new presentation components.

## 5. Pupil Experience (Present Mode)
- Create a `PupilShortTextActivity` component to render the question, text input, and progress indicator.
- Hook up blur/submit handlers so when the pupil leaves the input, we trigger evaluation (see section 6) while disabling repeated submissions until completion.
- Manage UI states: idle, evaluating (show progress bar), saved, and error; respect locks or attempt limits consistent with existing activities.
- Ensure initial pupil submission (if it exists) pre-populates the text input without revealing score.

## 6. AI Scoring Pipeline
- Introduce an abstraction (e.g., `src/lib/ai/short-text-scoring.ts`) that composes the GPT-5 mini prompt using `OPEN_AI_KEY` and handles retries/errors.
- Reuse existing OpenAI client utilities if present; otherwise create a minimal fetch wrapper respecting the environment configuration.
- Server action triggered by pupil submission should:
  - Call AI scoring service with question/model/pupil answer.
  - Persist `aiModelScore` and derived `isCorrect` (`score >= 0.8`) in the submission body.
  - Surface a friendly error if the AI call fails and allow retry.

## 7. Teacher Override Workflow
- Provide UI (likely teacher review panel) that displays AI score and allows manual override of the score.
- When overridden, update submission body with `teacherOverrideScore` and recomputed `isCorrect` based on override value.
- Ensure overrides persist across views and are clearly distinguished from AI scores.

## 8. Testing & Documentation
- Add Playwright coverage for a pupil answering a short-text question and observing the evaluation flow (`tests/activities/short-text.spec.ts`).
- Consider lightweight integration tests for the AI scoring helper (stub network).
- Document the new activity in `specs/activities-short.md` change log and append relevant notes to `Planner Agents Playbook`.
- Run `npm run lint` and targeted Playwright specs before shipping.

## Open Questions
- Should `modelAnswer` be required for every short-text activity, or can it be blank (affects AI prompt quality)?
- Where should teacher overrides be surfaced in the UI—existing feedback panel or a new activity-specific modal?
- Do we need rate-limiting or debouncing to prevent excessive AI calls if pupils repeatedly blur/focus the input?
- Should `isCorrect` rely solely on `aiModelScore >= 0.8`, or be configurable per activity?
