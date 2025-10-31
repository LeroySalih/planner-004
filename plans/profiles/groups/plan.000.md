# Plan: `/profiles/groups/page`

## Current gaps
- The join flow always records members with the `pupil` role, so teachers cannot add themselves correctly.
- Group listings show membership details but offer no way to leave a group as required by the spec.
- Success and error handling is limited to the join flow; leaving a group needs similar user feedback.

## Proposed steps
1. **Load profile + memberships server-side** – add/extend a server action in `src/lib/server-actions/groups.ts` that resolves the authenticated user's profile (including `is_teacher`) and current group memberships with group details, returning data shaped by existing Zod schemas so the page can render without browser Supabase calls.
2. **Server action for joining** – implement a server action that normalises the join code, verifies the group exists/active, prevents duplicate memberships, and inserts the membership with the correct role derived from the profile before revalidating `"/profile/groups"`.
3. **Server action for leaving** – implement a complementary server action that deletes the current user's membership for a given group, revalidates the page, and surfaces clear success/error messaging.
4. **Convert UI to pure server component** – render join/leave panels within a server component that consumes the server actions directly, keeping any client-only behaviour isolated to minimal interactive elements (if unavoidable) while meeting the “prefer pure server components” guidance.

## Validation
- Manual QA: join a group as both teacher and pupil personas, verify duplicate joins are blocked, and confirm the membership list updates after joining/leaving.
- Supabase check: inspect the `group_membership` table to ensure records are inserted and removed without touching related group data.

## Open questions
- None – spec and playbook now clarify the components should be pure server components where possible.
