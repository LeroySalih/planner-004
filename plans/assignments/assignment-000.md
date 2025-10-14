# Assignment Reactivation After Soft Delete

## 1. Investigate & Confirm Current Behaviour
- Reproduce the conflict by creating → deleting (soft delete) → recreating the same assignment; capture the Supabase response showing `23505` on `assignments_pkey`.
- Inspect `assignments` table definition and RLS in Supabase metadata to confirm the compound primary key (`group_id`, `unit_id`, `start_date`) and understand any triggers that might interact with reactivation.
- Review client flows (assignment manager components plus server actions) to note where the inactive record remains cached or filtered out so the reactivated row reappears without a full refresh.

## 2. Server Action Adjustments
- Modify `createAssignmentAction` to perform a two-step operation: first try updating an existing row with `active = false` to `active = true` (and refresh dates), falling back to an insert if no row matches; log and return the revived record so callers stay consistent.
- Mirror the same behaviour in `batchCreateAssignmentsAction`, either via a transactional loop (update-then-insert) or an `upsert` with `onConflict` that sets `active = true` and updates `end_date`.
- Ensure the update paths include refreshed metadata (e.g., `end_date`, timestamps) so a reactivated assignment reflects the newly supplied values.
- Add targeted error handling for `PostgrestError.code === "23505"` so we can convert duplicate conflicts into the revival path if Supabase returns the conflict before the update runs.

## 3. Delete & Read Consistency
- Confirm `deleteAssignmentAction` and `batchDeleteAssignmentsAction` continue to soft-delete by flipping `active = false`; add safeguards to avoid redundant updates when the record is already inactive.
- Audit read helpers (`readAssignmentAction`, `readAssignmentsAction`, group-specific variants) to ensure they still filter to `active = true` and do not mis-handle the revived rows.
- Check any downstream data loaders (lesson assignments or dashboards) that may assume deleted assignments never reappear; update memoization keys or caches if needed so reactivations propagate.

## 4. UI & Feedback Flow
- Verify the client-side assignment manager handles the revived payload: optimistic state should reconcile against the returned server data without duplicate list entries.
- Provide user-facing feedback when a duplicate is revived (other than surfacing the raw Supabase error); consider a toast message explaining the assignment was reactivated.
- Ensure date pickers or validation flows do not disable previously used start dates once the assignment is deleted, keeping the UX consistent with auto-reactivation.

## 5. Testing & Validation
- Add or update Playwright coverage to exercise the create → delete → recreate flow and assert the assignment list shows the revived entry without error.
- If available, add server-side integration tests (or a manual QA script) to cover both single create/update and batch create scenarios, verifying `active` flips back to true.
- Run `npm run lint` and the impacted Playwright suite before publishing; document manual verification steps in the release notes if automated coverage is not feasible.

## Open Questions
- Reactivation does not restore related entities; they stay untouched per product decision.
- No additional auditing (reactivator identity or timestamp) required for this workflow.
