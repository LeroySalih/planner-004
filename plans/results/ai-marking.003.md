# Plan: Column Bulk Marking and Pupil Flagging (v003)

## Objective
Enable teachers to trigger AI marking for an entire column of submissions with one click and allow pupils to flag their results for review.

## 1. Database Migration (`033-add-flag-to-submissions.sql`)
- **Schema Update**: Add `is_flagged` boolean column to the `submissions` table (defaulting to `false`).
- **Function Updates**: 
    - Update `lesson_detail_bootstrap` to include `is_flagged` in the `activity_payload`.
    - Update `reports_get_prepared_report_dataset` to include `is_flagged` in the `submissions` segment of the JSON.

## 2. Type Updates (`src/types/index.ts`)
- Update `AssignmentResultCellSchema` to include `isFlagged: z.boolean().default(false)`.
- Ensure the transformation logic handles the snake_case `is_flagged` from the DB to camelCase `isFlagged` if necessary.

## 3. Server Action Updates
- **`toggleSubmissionFlagAction`**: New action for pupils to mark/unmark their work as needing resolution.
- **`src/lib/server-actions/assignment-results.ts`**: Update the core result loader to fetch the new `is_flagged` column.

## 4. Teacher UI: `src/components/assignment-results/assignment-results-dashboard.tsx`
- **Bulk Action**: 
    - Implement `handleColumnAiMark(activityIndex)` to collect all valid `submissionId`s in the column.
    - Use `triggerManualAiMarkingAction` for each.
    - Show a single toast summary with the total count.
- **Header**: Add a button to the `th` element to trigger the bulk action.
- **Visuals**: Add a flag icon/indicator to grid cells where `isFlagged` is true.

## 5. Pupil UI: `src/components/pupil/pupil-short-text-activity.tsx`
- Add a "Flag for review" toggle button that is visible when `feedbackVisible` is true.

## Verification
- Clicking column header triggers multiple background marking jobs.
- Only one toast appears informing of the total number of requests.
- Flagging work as a pupil shows up immediately on the teacher's dashboard via SSE.
