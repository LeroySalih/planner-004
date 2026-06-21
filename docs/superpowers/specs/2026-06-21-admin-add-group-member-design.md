# Admin Manually Adds Group Members — Design

## Problem

On `/groups/[groupId]`, teachers can remove pupils, import pupils from another group, or let pupils self-join via a join code — but there's no way to directly add one specific, already-known pupil to a group. Admins need a way to do this manually.

## Goals

- Admins can add a single named pupil to a group from `/groups/[groupId]`, via a search-as-you-type picker.
- Only admins (`hasRole(profile, 'admin')`) see/can use this control — regular teachers viewing their own group's page do not get it.
- The picker excludes pupils already in this group and excludes teachers.

## Non-goals

- No bulk add (one pupil per submission — re-open the dialog to add another).
- No new server-side pupil search action — the picker fetches the existing full pupil list once (`listPupilsWithGroupsAction()`) and filters client-side as the admin types, per the decision that school rolls are small enough for this to be simple and sufficient.
- No changes to `removeGroupMemberAction`, `updateGroupMemberRoleAction`, or any other existing group-membership action.
- No changes to the `group_membership` table schema — it already has exactly the columns needed (`group_id`, `user_id` composite PK, no role/status columns).

## Design

### 1. New server action: `addGroupMemberAction`

**File:** `src/lib/server-actions/groups.ts`

Add near `removeGroupMemberAction` (reusing its existing `RemoveGroupMemberReturnSchema` — `{success: boolean, error: string | null}` — since the shape is identical):

```ts
const AddGroupMemberInputSchema = z.object({
  groupId: z.string().min(1),
  userId: z.string().min(1),
})

export async function addGroupMemberAction(
  input: { groupId: string; userId: string },
  options?: { currentProfile?: AuthenticatedProfile | null },
) {
  const parsed = AddGroupMemberInputSchema.safeParse(input)
  if (!parsed.success) {
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "Invalid group member payload.",
    })
  }

  const { groupId, userId } = parsed.data
  const profile = options?.currentProfile ?? (await requireAuthenticatedProfile())
  if (!hasRole(profile, 'admin')) {
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "You do not have permission to add pupils.",
    })
  }

  const client = createPgClient()
  try {
    await client.connect()
    await client.query(
      "insert into group_membership (group_id, user_id) values ($1, $2) on conflict do nothing",
      [groupId, userId],
    )
  } catch (error) {
    console.error("[v0] Server action failed for adding group member:", { groupId, userId, error })
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "Unable to add pupil to group.",
    })
  } finally {
    try {
      await client.end()
    } catch {
      // ignore close errors
    }
  }

  revalidatePath(`/groups/${groupId}`)
  revalidatePath("/groups")

  return RemoveGroupMemberReturnSchema.parse({ success: true, error: null })
}
```

Authorization is admin-only via `hasRole`, not `requireTeacherOrAdminAccess` — that helper encodes "self or admin," which doesn't apply here since group membership has no "owning teacher" concept to be "self" about.

`addGroupMemberAction` is exported from `src/lib/server-updates.ts` alongside the other group actions (simple re-export, matching the existing pattern for every other action in that file).

### 2. Pupil picker data source

No new read action. The dialog calls the existing `listPupilsWithGroupsAction()` (returns `{pupilId, pupilName, pupilEmail, isTeacher, groups: {group_id, group_name}[]}[]`) once when it opens, then filters client-side to pupils where `isTeacher === false` and `!groups.some(g => g.group_id === groupId)`.

### 3. New component: `AddMemberDialog`

**File:** `src/app/groups/[groupId]/add-member-dialog.tsx`

Same overall shape as the existing `ImportPupilsDialog` (`Dialog` + trigger `Button`, `useTransition` for the pending state, `useToast` for feedback, `router.refresh()` on success) but the picker is a `Popover` + `Command` combobox (typing filters the eligible-pupil list by name or email) instead of a plain `<Select>`, since this list can be much larger than the group dropdown in the import dialog.

Props: `{ groupId: string }`. On mount/open, calls `listPupilsWithGroupsAction()` and computes the eligible list as described above. On selecting a pupil and confirming, calls `addGroupMemberAction({ groupId, userId: selectedPupilId })`.

### 4. Page wiring

**File:** `src/app/groups/[groupId]/page.tsx`

- Import `hasRole` alongside `requireTeacherProfile` from `@/lib/auth`.
- Compute `const isAdmin = hasRole(teacherProfile, 'admin')` after `requireTeacherProfile()`.
- Import and render `<AddMemberDialog groupId={group.group_id} />` next to the existing `<ImportPupilsDialog>` in the header, gated by `{isAdmin && <AddMemberDialog groupId={group.group_id} />}`.

No other change to the page — `pupils`, the membership list, and all existing handlers stay untouched.

## Testing

Same situation as prior admin features in this codebase: no unit/integration test runner for server actions exists. Verification is manual:
- As admin: open `/groups/[groupId]`, confirm the "Add Member" control is visible, open it, type part of a pupil's name not currently in the group, select them, confirm they appear in the member list after the dialog closes/refreshes. Confirm a pupil already in the group, and any teacher, never appear in the picker's eligible list.
- As non-admin teacher: confirm the "Add Member" control does not render at all on their own group's page.
- Directly calling `addGroupMemberAction` as a non-admin (e.g. via a tampered client call) returns `{success: false, error: "You do not have permission to add pupils."}` rather than mutating data.

## Files touched

- `src/lib/server-actions/groups.ts` — add `AddGroupMemberInputSchema`, `addGroupMemberAction`; add `hasRole` to the `@/lib/auth` import
- `src/lib/server-updates.ts` — re-export `addGroupMemberAction`
- `src/app/groups/[groupId]/add-member-dialog.tsx` — new component
- `src/app/groups/[groupId]/page.tsx` — compute `isAdmin`, render `<AddMemberDialog>` conditionally
