# MCQ Activity Implementation Plan

## 1. Data & Type Safety
- Inspect `public.submissions` columns to confirm `submission_id`, `activity_id`, `user_id`, `submitted_at`, and `body`.
- Add a `SubmissionSchema` + `SubmissionsSchema` to `src/types/index.ts` (using zod) and export a `Submission` type.
- Define an `MCQActivityBody` zod schema capturing `question: string`, `imageFile?: string | null`, `imageAlt?: string | null`, `options: { id: string; text: string }[]` (minimum two items), and `correctOptionId: string`.
- Extend `LessonActivity` helpers (`normalizeActivityBody`, `getActivityTextValue`, etc. in `src/lib/server-actions/lesson-activities.ts` and `src/components/lessons/activity-view/utils.ts`) so MCQ payloads are normalized and typed consistently on load/save.

## 2. Authoring (Edit Mode)
- Update the lesson authoring surface (`src/components/units/lesson-sidebar.tsx`) to render a new `<McqActivityEditor>` when `activity.type === "mcq"`.
- Build `McqActivityEditor` in `src/components/units/activities/mcq-editor.tsx`:
  - Inputs for question text (required) and optional image attachment (re-use existing file selection pattern and display via `ActivityImagePreview`).
  - Dynamic option list with add/remove controls (min 2 / max 4 per spec) and validation flags when empty.
  - Radio group or select for choosing the correct option (must reference an existing option).
- Wire editor callbacks into existing local-update + persist flows: update activity body in component state, trigger `updateLessonActivityAction` with normalized MCQ body, and show inline validation errors prior to save.

## 3. Lesson Presentation (Teacher View)
- Update `src/components/lessons/activity-view/index.tsx` to support `activity.type === "mcq"`:
  - **Short mode**: show the question text only (truncate to reasonable length) and indicate the activity is multiple-choice.
  - **Present mode**: render the question, optional image, and list all options; highlight the correct answer for teachers (icon/label) but do not expose correctness when reused in pupil mode.
- Ensure `LessonActivityPresentationClient` can navigate MCQ activities without additional data requirements.

## 4. Pupil Experience (Present Mode)
- Introduce a `PupilMcqActivity` component under `src/components/pupil/` that:
  - Accepts `activity`, `initialSelection` (fetched server-side), and `onSelectionChange`.
  - Shows question + options, allows one selection, and prevents editing if the lesson is locked (follow same `canUpload` gating used by other pupil components).
- Modify `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`:
  - Fetch the current pupil’s MCQ submissions alongside upload activity data by calling a new server action (see section 5).
  - Pass the saved selection into `PupilMcqActivity` and render it when `activity.type === "mcq"`.

## 5. Submission Handling
- Create server actions in `src/lib/server-actions/submissions.ts`:
  - `getSubmissionForActivity({ activityId, userId })` returning the latest row (typed with `Submission`).
  - `upsertMcqSubmission({ activityId, userId, selection })` that inserts or updates the row, storing `{ optionId }` in the `body` JSON.
- Ensure these actions enforce payload validation with the new `MCQActivityBody` schema and return consistent success/error shapes.
- Update RLS policies in Supabase (if needed) so authenticated pupils can insert/update their own submissions and read their prior responses.

## 6. Checking Prior Answers
- When rendering MCQs in pupil mode, call `getSubmissionForActivity` in the page loader so the component knows if the pupil has already answered.
- Preselect the previously chosen option; optionally disable resubmission unless spec requires multiple attempts (clarify with product—default to allowing overwrite while warning if they already answered).
- Adjust UI copy to show “Saved answer” state when a prior submission exists without revealing correctness.

## 7. Validation & Feedback
- Add shared utility functions/tests to validate MCQ bodies (e.g., `validateMcqBody` unit test to ensure at least two options and correct answer alignment).
- Update any seed data or fixtures to include at least one MCQ example (if required for manual QA).
- Run `npm run lint` and relevant Playwright flows (or add a focused MCQ spec under `tests/pupil/mcq.spec.ts`) to cover answering and revisiting an MCQ.

## 8. Rollout Notes
- Document the new MCQ activity type in `CHANGELOG`/`src/releases.md`.
- Provide guidance for content authors on image sizing and option limits.
- Confirm Supabase storage + submission data retention requirements and include migration/rollback steps if policies change.
