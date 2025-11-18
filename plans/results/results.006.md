## Goal
Implement an optimistic “immediate apply, then rollback on error” flow for the /results/assignments/[assignmentId] override sidebar so saving feedback or scores feels instant while remaining consistent with Supabase and existing realtime updates.

## Plan
1) Define optimistic state model
- Capture the minimal cell snapshot needed for rollback (scores, status, feedback, success criteria scores, submissionId, needsMarking, submittedAt).
- Track an optimistic mutation token per cell (row+activity) to ignore late failures that no longer match the current edit.

2) Apply optimistic update on submit
- In the override submit handler, immediately update matrixState/selection with the drafted values and mark the cell as “optimistic” (e.g., add a transient flag in component state).
- Keep useActionState for the server call; include the token so success/failure handlers can verify relevance.
- Preserve existing validation (percent ranges) and toasts; add a lightweight “saving…” affordance on the sheet button using the optimistic flag instead of waiting for server result.

3) Handle success (noop) vs failure (rollback)
- On success: clear the optimistic flag/token and leave the optimistic values in place (they match the server call); keep the success toast.
- On failure: if the token matches the last optimistic mutation, restore the saved snapshot for that cell, clear the optimistic flag/token, and show an error toast.
- Ensure a new optimistic submit replaces the prior token and snapshot, cancelling pending rollback behavior for superseded requests.

4) Reconcile with realtime updates
- If a realtime payload arrives for the same cell while an optimistic mutation is pending, prefer the realtime value but clear any optimistic flag/token to avoid double-applies.
- Make sure rollback does not fight with newer realtime data: only rollback when the token matches and the current cell still reflects the optimistic edit.

5) Server action + telemetry considerations
- No behavior change needed server-side, but confirm the action returns synchronously as it does now and logs telemetry (already wired).
- Consider adding a distinguishing telemetry param for optimistic calls (e.g., routeTag suffix) if helpful, but keep APIs unchanged for now.

6) Testing and verification
- Add Playwright coverage for optimistic override: submit override, see immediate UI change, simulate server failure (mock action) and confirm rollback + error toast; success path keeps values.
- Manually verify with realtime enabled: submit override, see instant UI update, then confirm Supabase change leaves UI stable and no flicker.

## Open questions / assumptions
- Resolved: Keep realtime values if they arrive after an optimistic edit; rollback only when the pending token matches and the current cell still reflects the optimistic edit.
- Resolved: Failure feedback stays via toast; also log errors to console for debugging.
