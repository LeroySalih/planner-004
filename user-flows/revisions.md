# Revisions

A revision allows a pupil to practice a specific concept multiple times after
the completion of a lesson. It serves as a test mode where content (videos, text
slides) is hidden, and only assessable activities are presented.

## Pupil Flow

### 1. Starting a Revision

- **Entry Point**: A pupil initiates a revision by clicking the "Practise
  Revision" button (or the Play icon in compact views) associated with a
  completed lesson.
- **System Action**:
  - A new revision record is created with a status of `in_progress`.
  - Determines which activities from the original lesson are eligible for
    revision (e.g., Short Text, Multiple Choice, Uploads).
  - Redirects the user to the revision page (`/revisions/[revisionId]`).

### 2. Taking a Revision (In Progress State)

Upon entering the revision page, the user sees:

- **Header**: Displays "Revision: [Lesson Title]" and a "Back to Lesson" link.
- **Activity List**: A vertical list of questions/activities to answer.
  Content-only steps (like reading text or watching videos) are excluded.

#### Answering Questions

- **Multiple Choice Questions (MCQ)**:
  - User selects an option.
  - **Auto-Save**: The answer is saved immediately upon selection.
  - **Feedback**: A small status indicator ("Saving...", "Answer saved")
    appears. No correctness feedback is shown yet.

- **Short Text Questions**:
  - User types an answer into a text area.
  - **Save**: The answer performs an auto-save on blur (when clicking away) or
    can be manually saved via a "Save answer" button.
  - **Feedback**: Displays "Answer saved" upon success.

- **Upload Activities**:
  - User can upload a file or a URL depending on the activity type.

### 3. Submitting the Revision

- **Submit Action**: Once satisfied with their answers, the user clicks the
  "Submit Revision" button at the bottom of the page.
- **State Change**:
  - The revision status updates to `submitted`.
  - The "Submit Revision" button is removed.
  - Input fields become read-only (disabled).

### 4. Reviewing Results (Submitted State)

Immediately after submission, the UI updates to show results:

- **Score Header**: The header now displays a badge with the total score and
  percentage (e.g., "Score: 3 / 5 (60%)").
- **Activity Feedback**:
  - **MCQ**: Shows whether the selected answer was correct or incorrect, along
    with the score (e.g., "Score: 1 / 1").
  - **Short Text**: Displays general feedback (e.g., "Waiting marking...") or
    AI-generated feedback if processed. These are typically queued for AI
    marking upon submission.
  - **Uploads**: Marked as "pending_manual" review.

## Teacher UI

A teacher can see the revisions that have taken place and can view the pupil
history for each revision. Real-time updates allow teachers to track progress as
it happens.
