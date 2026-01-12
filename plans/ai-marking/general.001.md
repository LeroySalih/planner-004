# Plan: Pupil-Centric AI Marking (Row AI Mark)

## 1. Objective
Enable teachers to trigger AI marking for **all** submissions of a specific pupil (row) in the assignment results matrix by clicking on the pupil's average score. This complements the existing "Column AI Mark" (all pupils for one activity).

## 2. Rationale
Currently, teachers can bulk-mark an entire activity (column). However, often a teacher might want to focus on marking a single pupil's completed work across all activities. This feature adds that granularity without changing the underlying marking infrastructure.

## 3. Implementation Details

### A. Component: `AssignmentResultsDashboard`
**File:** `src/components/assignment-results/assignment-results-dashboard.tsx`

1.  **New Handler: `handleRowAiMark(rowIndex: number)`**
    *   **Input:** Index of the pupil row.
    *   **Logic:**
        *   Retrieve the `row` from `groupedRows[rowIndex]`.
        *   Iterate through `row.cells` to collect all valid `submissionId`s.
        *   Filter out cells without `submissionId`.
        *   If no submissions found, show a `toast.info`.
        *   If submissions exist, call `triggerBulkAiMarkingAction` with the list of submission IDs.
        *   Wrap the call in `startAiMarkTransition` to manage the `aiMarkPending` state.
        *   **Action Call:** `triggerBulkAiMarkingAction({ assignmentId, submissions: [...] })`.
        *   **Feedback:** `toast.success` on success, `toast.error` on failure.

2.  **UI Update: Average Score Cell**
    *   **Location:** The `<td>` rendering `{formatPercent(row.averageScore ?? null)}`.
    *   **Change:**
        *   Replace the static text with a `<button>` (or `Button` component if appropriate for table density).
        *   **Styling:** Use a variant that looks interactive (e.g., hover effect, cursor pointer). Maybe `variant="ghost"` or just clean CSS classes to match the table aesthetic.
        *   **Interaction:** `onClick={() => handleRowAiMark(rowIndex)}`.
        *   **State:** Disable if `aiMarkPending` is true.
        *   **Tooltip:** (Optional but good) "AI Mark all for this pupil".

### B. Backend / Infrastructure
*   **No changes required.**
*   The `triggerBulkAiMarkingAction` accepts a list of `{ submissionId }`.
*   The `ai_marking_queue` treats each submission as an individual task.
*   The queue processor (`processNextQueueItem`) independently fetches context (question, model answer) for each submission, so mixing activities in the queue is natively supported.
*   The DO function logic remains untouched.

## 4. Steps
1.  Implement `handleRowAiMark` in `AssignmentResultsDashboard`.
2.  Update the JSX for the pupil's average score column to use the new handler.
3.  Verify that clicking the average score queues tasks for all that pupil's submissions.
