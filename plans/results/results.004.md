# Plan: Results Cell Background States

## Goal
- Update the `/results/assignments/[group__lesson]` grid so pupil activity cells show white when no submission exists and gray whenever there is a submission waiting to be marked (including if a pupil resubmits after a teacher’s mark).

## Current Understanding
- Cells currently default to a gray background regardless of submission status, so teachers cannot differentiate which activities still require review.
- Submission state already exists in the data returned by `readAssignmentResultsAction` (values, uploads, override status), and the cell UI can respond to that metadata without introducing new Supabase calls.
- We need a dependable signal for “needs marking,” likely derived from presence of a submission that either has no teacher override yet or has a `updated_at` newer than the stored mark timestamp.

## Implementation Steps
1. **Define the state signal**
   - Audit the submission data available to the grid (value uploads, override timestamps) and settle on a boolean like `needsMarking`.
   - Ensure the server action (or selectors) flags when a pupil has ever submitted but has not yet been marked, or when a pupil resubmits after a mark.

2. **Add derived state to the client**
   - Thread the new `needsMarking` indicator through the grid cell component props (or compute it there if timestamps are available).
   - Normalize handling for both typed responses and file uploads so they drive the same UI state.

3. **Update cell styling**
   - Apply Tailwind conditional classes so untouched cells stay `bg-white`, `needsMarking` submissions reuse the muted gray background, and scored cells fall back to the existing red/amber/green palette.
   - Confirm hover/focus states and dark mode tokens align with `src/app/globals.css`.
   - Ensure automatic scoring/remediation states reuse the same red/amber/green palette as manual overrides so both communicate performance consistently.

4. **Handle re-submissions post-mark**
   - Ensure the Realtime/optimistic update path refreshes `needsMarking` whenever a pupil submits again so the background flips to gray immediately.
   - Double-check that saving a teacher mark resets `needsMarking` to false so the cell returns to white until the next pupil submission.

5. **Tests & Verification**
   - Add or update Playwright coverage (once available) to assert the background color or CSS class changes after submissions/marking.
   - Manually verify both value-entry and file-upload workflows plus the resubmission after marking case.

## Deliverables
- Updated server/client logic powering `/results/assignments/[group__lesson]` to expose `needsMarking`.
- Refreshed grid styling so gray cells strictly denote “awaiting marking,” while white cells represent untouched or fully processed submissions.
