# Activities Upload from Markdown File

## Overview

Allow teachers to upload a markdown file containing activity definitions to a lesson. Activities are parsed from the file and bulk-created, appending to the end of the lesson's existing activity list.

## Supported Activity Types

Only the following activity types are parsed from the uploaded file. Any other content or unrecognised activity blocks are silently ignored.

### Multiple Choice Question (`multiple-choice-question`)

Markdown format:

```
## MCQ: <title>

<question text>

- [x] Option A (correct answer)
- [ ] Option B
- [ ] Option C
- [ ] Option D

LO: <learning-objective-title>
SC: <success-criteria-description>
```

- The question text is everything between the heading and the first option.
- Options use `- [x]` for the correct answer and `- [ ]` for incorrect answers.
- Exactly one `[x]` option is required.
- 2 to 4 options are required.
- `LO:` and `SC:` lines are optional. Multiple `SC:` lines are allowed.

### Short Text Question (`short-text-question`)

Markdown format:

```
## SHORT: <title>

<question text>

ANSWER: <model answer>

LO: <learning-objective-title>
SC: <success-criteria-description>
```

- The question text is everything between the heading and the `ANSWER:` line.
- The `ANSWER:` line provides the model answer and is required.
- `LO:` and `SC:` lines are optional. Multiple `SC:` lines are allowed.

## Learning Objective and Success Criteria Linking

- `LO:` references a learning objective by its title. The LO must already be attached to the lesson (present in `lesson_success_criteria` via a linked LO). If the referenced LO is not found among the lesson's linked LOs, the upload fails with a user-friendly error indicating which activity and LO caused the failure.
- `SC:` references a success criterion by its description text. The SC must already be attached to the lesson (present in `lesson_success_criteria`). If the referenced SC is not found, the upload fails with a user-friendly error indicating which activity and SC caused the failure.
- When a valid `SC:` is found, the activity is linked to that success criterion via the `activity_success_criteria` table.
- LO lines are used for validation only (to confirm the SC belongs to the expected LO). If an `LO:` is specified alongside `SC:` lines, all referenced SCs must belong to that LO. If they don't, the upload fails with a descriptive error.

## Upload Behaviour

1. **File type**: Only `.md` files are accepted. The upload input restricts to `.md` files.
2. **Parsing**: The file is parsed client-side into an array of activity definitions.
3. **Validation**: All activities are validated before any are created:
   - Activity body schemas must be valid (question text present, options valid for MCQ, model answer present for short-text).
   - Referenced LOs must be attached to the lesson.
   - Referenced SCs must be attached to the lesson.
   - If any activity fails validation, none are created.
4. **Transactional creation**: All activities are created in a single database transaction using `BEGIN`/`COMMIT`. If any insert fails, the entire transaction is rolled back with `ROLLBACK`.
5. **Ordering**: New activities are appended to the end of the lesson's existing activities, in the order they appear in the markdown file.
6. **Error reporting**: On failure, a user-friendly toast message is shown describing what went wrong. Examples:
   - `Activity "Q3: Photosynthesis" references Learning Objective "LO: Cell Division" which is not attached to this lesson.`
   - `Activity "Q1: Mitosis" references Success Criterion "Describe the stages" which is not attached to this lesson.`
   - `Activity "Q2: DNA" has no correct answer marked. Use [x] to mark the correct option.`
   - `Upload failed: database error. No activities were created.`

## UI Placement

- An **"Upload Activities"** button is added to the `LessonActivitiesManager` component, next to the existing "Add activity" button.
- The button opens a file picker for `.md` files.
- While the upload is processing, the button shows a loading spinner.
- On success, a toast confirms `X activities uploaded successfully` and the activity list refreshes.
- On failure, a toast shows the error message. No activities are created.

## Server Action

A new server action `uploadActivitiesFromMarkdownAction` is created in `src/lib/server-actions/lesson-activities.ts`:

```typescript
export async function uploadActivitiesFromMarkdownAction(
  unitId: string,
  lessonId: string,
  activities: Array<{
    title: string
    type: "multiple-choice-question" | "short-text-question"
    bodyData: unknown
    successCriteriaIds: string[]
  }>
): Promise<{
  success: boolean
  error?: string | null
  data?: { count: number }
}>
```

- Accepts pre-parsed and pre-validated activity definitions.
- Wraps all inserts in a single `BEGIN`/`COMMIT` transaction.
- On any failure, issues `ROLLBACK` and returns a descriptive error.
- Revalidates the lesson page cache on success.

## Out of Scope

- Editing or updating existing activities via upload (this is create-only).
- Activity types other than `multiple-choice-question` and `short-text-question`.
- Image uploads within the markdown file.
- Summative/assessment flag setting (defaults based on activity type scorability).
