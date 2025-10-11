# MCQ Activity Follow-up Plan

## Scope
- Only adjust items highlighted in the 25-10-11 specification updates: MCQ present-mode behaviour, edit experience, and submission payload structure.
- Leave unchanged activity types untouched.

## Plan

1. **Submission Schema & Actions**
   - Update `submissions` typing to reflect `{ answer_chosen, is_correct }`.
   - Adjust MCQ submission server actions to persist both fields, deriving `is_correct` by comparing against the activity’s correct option.
   - Refresh read paths (pupil lesson loader, client components) to parse the new shape while remaining tolerant of legacy data during the rollout.

2. **MCQ Edit Experience**
   - Replace the plain textarea with the shared `RichTextEditor`, pruning its toolbar to `bold`, `italic`, `justify`, and `code` controls per spec.
   - Constrain the answers UI to four text inputs shown simultaneously, each prefixed by its radio button for correct-answer selection.
   - Validate that at least two answers contain text and enforce the correct-answer requirement before save.

3. **Presentation Behaviour**
   - Ensure neither pupil nor teacher views expose the correct answer by default; remove existing auto-highlighting.
   - In teacher present mode, add a “Reveal answer” toggle that surfaces the correct choice only after activation, keeping pupil mode unchanged.
   - Preserve the spec’s “no feedback” rule for pupils while maintaining stored correctness metadata for reporting.

4. **Regression Pass**
   - Re-run linting, adjust affected tests/playground flows if necessary, and document the refined behaviour in release notes once validated.
