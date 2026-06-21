# Admin Manually Adds Group Members Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins add a specific, named pupil directly to a group from `/groups/[groupId]`, via a search-as-you-type picker, visible only to admins.

**Architecture:** A new server action (`addGroupMemberAction`) mirrors the existing `removeGroupMemberAction`'s shape exactly (input schema, raw `pg` client, return schema), gated by `hasRole(profile, 'admin')`. A new client dialog component reuses the existing `listPupilsWithGroupsAction()` pupil list (no new read action) and filters it client-side into a `Command`+`Popover` combobox. The page computes `isAdmin` and renders the dialog conditionally.

**Tech Stack:** Next.js server actions, `pg` `Client` (raw, not the pooled `query()` helper — matching this file's existing pattern for mutations), Zod, shadcn/ui `Command`/`Popover`/`Dialog`/`Button` primitives (already present, unused elsewhere in the app).

**Testing note:** No unit/integration test runner exists for server actions in this repo (confirmed across prior features in this codebase) — only Playwright E2E, not wired for this. Each task ends with a manual verification step; Task 4 is the end-to-end pass.

---

### Task 1: Add `addGroupMemberAction`

**Files:**
- Modify: `src/lib/server-actions/groups.ts`
- Modify: `src/lib/server-updates.ts`

Current relevant context in `src/lib/server-actions/groups.ts`:

```ts
import {
  type AuthenticatedProfile as BaseAuthenticatedProfile,
  getAuthenticatedProfile,
  hashPassword,
  requireAuthenticatedProfile,
  requireTeacherProfile,
} from "@/lib/auth";
```

```ts
const RemoveGroupMemberInputSchema = z.object({
  groupId: z.string().min(1),
  userId: z.string().min(1),
});

const RemoveGroupMemberReturnSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
});
```

```ts
export async function removeGroupMemberAction(
  input: { groupId: string; userId: string },
  options?: { currentProfile?: AuthenticatedProfile | null },
) {
  const parsed = RemoveGroupMemberInputSchema.safeParse(input);
  if (!parsed.success) {
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "Invalid group member removal payload.",
    });
  }

  const { groupId, userId } = parsed.data;

  console.log("[v0] Server action started for removing group member:", {
    groupId,
    userId,
  });

  const profile = options?.currentProfile ??
    (await requireAuthenticatedProfile());
  if (!profile.isTeacher) {
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "You do not have permission to remove pupils.",
    });
  }

  const client = createPgClient();

  try {
    await client.connect();
    const { rowCount } = await client.query(
      "delete from group_membership where group_id = $1 and user_id = $2",
      [groupId, userId],
    );

    if (rowCount === 0) {
      console.error(
        "[v0] Server action failed for removing group member: no rows affected",
        { groupId, userId },
      );
      return RemoveGroupMemberReturnSchema.parse({
        success: false,
        error: "Unable to remove pupil from group.",
      });
    }
  } catch (error) {
    console.error("[v0] Server action failed for removing group member:", {
      groupId,
      userId,
      error,
    });
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "Unable to remove pupil from group.",
    });
  } finally {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }

  revalidatePath(`/groups/${groupId}`);
  revalidatePath("/groups");

  console.log("[v0] Server action completed for removing group member:", {
    groupId,
    userId,
  });

  return RemoveGroupMemberReturnSchema.parse({
    success: true,
    error: null,
  });
}
```

- [ ] **Step 1: Update the `@/lib/auth` import**

Change:
```ts
import {
  type AuthenticatedProfile as BaseAuthenticatedProfile,
  getAuthenticatedProfile,
  hashPassword,
  requireAuthenticatedProfile,
  requireTeacherProfile,
} from "@/lib/auth";
```
to:
```ts
import {
  type AuthenticatedProfile as BaseAuthenticatedProfile,
  getAuthenticatedProfile,
  hasRole,
  hashPassword,
  requireAuthenticatedProfile,
  requireTeacherProfile,
} from "@/lib/auth";
```

- [ ] **Step 2: Add the input schema**

Add directly after the existing `RemoveGroupMemberReturnSchema` declaration:

```ts
const AddGroupMemberInputSchema = z.object({
  groupId: z.string().min(1),
  userId: z.string().min(1),
});
```

- [ ] **Step 3: Add `addGroupMemberAction`**

Add this function directly after `removeGroupMemberAction` (i.e. right after its closing brace, before `resetPupilPasswordAction`):

```ts
export async function addGroupMemberAction(
  input: { groupId: string; userId: string },
  options?: { currentProfile?: AuthenticatedProfile | null },
) {
  const parsed = AddGroupMemberInputSchema.safeParse(input);
  if (!parsed.success) {
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "Invalid group member payload.",
    });
  }

  const { groupId, userId } = parsed.data;

  console.log("[v0] Server action started for adding group member:", {
    groupId,
    userId,
  });

  const profile = options?.currentProfile ??
    (await requireAuthenticatedProfile());
  if (!hasRole(profile, "admin")) {
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "You do not have permission to add pupils.",
    });
  }

  const client = createPgClient();

  try {
    await client.connect();
    await client.query(
      "insert into group_membership (group_id, user_id) values ($1, $2) on conflict do nothing",
      [groupId, userId],
    );
  } catch (error) {
    console.error("[v0] Server action failed for adding group member:", {
      groupId,
      userId,
      error,
    });
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "Unable to add pupil to group.",
    });
  } finally {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }

  revalidatePath(`/groups/${groupId}`);
  revalidatePath("/groups");

  console.log("[v0] Server action completed for adding group member:", {
    groupId,
    userId,
  });

  return RemoveGroupMemberReturnSchema.parse({
    success: true,
    error: null,
  });
}
```

Note: `AuthenticatedProfile` here refers to the type already imported/aliased in this file as `BaseAuthenticatedProfile` and re-exported/used as `AuthenticatedProfile` elsewhere in the same file (matching exactly how `removeGroupMemberAction`'s signature already uses it — copy that exact type reference, don't invent a new one).

- [ ] **Step 4: Re-export from `server-updates.ts`**

In `src/lib/server-updates.ts`, the groups re-export block currently reads:

```ts
export {
  createGroupAction,
  deleteGroupAction,
  type GroupActionResult,
  importGroupMembersAction,
  joinGroupByCodeAction,
  type JoinGroupResult,
  leaveGroupAction,
  type LeaveGroupResult,
  listPupilsWithGroupsAction,
  type ProfileGroupsResult,
  readGroupAction,
  readGroupsAction,
  readProfileGroupsForCurrentUserAction,
  removeGroupMemberAction,
  resetPupilPasswordAction,
  updateGroupAction,
  updateGroupMemberRoleAction,
  updatePupilParentEmailAction,
} from "./server-actions/groups";
```

Add `addGroupMemberAction` in alphabetical position (right after the opening brace, before `createGroupAction`):

```ts
export {
  addGroupMemberAction,
  createGroupAction,
  deleteGroupAction,
  type GroupActionResult,
  importGroupMembersAction,
  joinGroupByCodeAction,
  type JoinGroupResult,
  leaveGroupAction,
  type LeaveGroupResult,
  listPupilsWithGroupsAction,
  type ProfileGroupsResult,
  readGroupAction,
  readGroupsAction,
  readProfileGroupsForCurrentUserAction,
  removeGroupMemberAction,
  resetPupilPasswordAction,
  updateGroupAction,
  updateGroupMemberRoleAction,
  updatePupilParentEmailAction,
} from "./server-actions/groups";
```

- [ ] **Step 5: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`

Expected: no new errors beyond the two pre-existing unrelated baseline errors in `tests/prototypes/fast-ui.spec.ts`. Do NOT run `npm run build` — a `npm run dev` server may be running in the background for this project, and running `next build` concurrently corrupts the shared `.next/` directory (this has happened before in this project).

- [ ] **Step 6: Self-review**

`git diff src/lib/server-actions/groups.ts src/lib/server-updates.ts` — confirm: the auth import gains `hasRole`; one new schema (`AddGroupMemberInputSchema`) and one new function (`addGroupMemberAction`) added, placed exactly where specified; nothing else in either file touched; the re-export block gains exactly one new line.

- [ ] **Step 7: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/lib/server-actions/groups.ts src/lib/server-updates.ts
git commit -m "Add addGroupMemberAction for admin manual pupil add"
```

---

### Task 2: Add the `AddMemberDialog` component

**Files:**
- Create: `src/app/groups/[groupId]/add-member-dialog.tsx`

This mirrors the existing `src/app/groups/[groupId]/import-pupils-dialog.tsx` (`Dialog` + trigger `Button`, `useTransition`, `useToast`, `router.refresh()` on success), but uses a `Popover`+`Command` combobox instead of a `<Select>`, and sources its options from `listPupilsWithGroupsAction()` instead of a prop.

Reference: `listPupilsWithGroupsAction()` (from `@/lib/server-updates`) returns `Promise<ReportsPupilListing[]>` where each item has shape `{ pupilId: string; pupilName: string; pupilEmail?: string | null; isTeacher: boolean; groups: { group_id: string; group_name: string | null }[]; fatherEmail?: string | null; motherEmail?: string | null }` (type `ReportsPupilListing` exported from `@/types`).

- [ ] **Step 1: Create the file**

Create `src/app/groups/[groupId]/add-member-dialog.tsx`:

```tsx
"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, UserPlus } from "lucide-react"

import type { ReportsPupilListing } from "@/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useToast } from "@/components/ui/use-toast"
import { addGroupMemberAction, listPupilsWithGroupsAction } from "@/lib/server-updates"
import { cn } from "@/lib/utils"

interface AddMemberDialogProps {
  groupId: string
}

export function AddMemberDialog({ groupId }: AddMemberDialogProps) {
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pupils, setPupils] = useState<ReportsPupilListing[]>([])
  const [loadingPupils, setLoadingPupils] = useState(false)
  const [selectedPupilId, setSelectedPupilId] = useState<string>("")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    if (!open) return
    setLoadingPupils(true)
    listPupilsWithGroupsAction()
      .then((data) => setPupils(data))
      .finally(() => setLoadingPupils(false))
  }, [open])

  const eligiblePupils = pupils
    .filter((p) => !p.isTeacher)
    .filter((p) => !p.groups.some((g) => g.group_id === groupId))

  const selectedPupil = eligiblePupils.find((p) => p.pupilId === selectedPupilId) ?? null

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setSelectedPupilId("")
    }
  }

  async function handleAdd() {
    if (!selectedPupilId) return

    startTransition(async () => {
      try {
        const result = await addGroupMemberAction({ groupId, userId: selectedPupilId })

        if (result.success) {
          toast({
            title: "Pupil added",
            description: `${selectedPupil?.pupilName ?? "Pupil"} was added to this group.`,
          })
          handleOpenChange(false)
          router.refresh()
        } else {
          toast({
            variant: "destructive",
            title: "Add failed",
            description: result.error ?? "Unknown error occurred.",
          })
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Add failed",
          description: "An unexpected error occurred.",
        })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="flex items-center gap-2 bg-white text-black hover:bg-slate-100">
          <UserPlus className="h-4 w-4" />
          Add Member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Member</DialogTitle>
          <DialogDescription>
            Search for a pupil by name or email to add them directly to this group.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={pickerOpen}
                className="w-full justify-start font-normal"
              >
                {selectedPupil ? selectedPupil.pupilName : "Select a pupil..."}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] p-0">
              <Command>
                <CommandInput placeholder="Search by name or email..." />
                <CommandList>
                  <CommandEmpty>
                    {loadingPupils ? "Loading pupils..." : "No eligible pupils found."}
                  </CommandEmpty>
                  <CommandGroup>
                    {eligiblePupils.map((pupil) => (
                      <CommandItem
                        key={pupil.pupilId}
                        value={`${pupil.pupilName} ${pupil.pupilEmail ?? ""}`}
                        onSelect={() => {
                          setSelectedPupilId(pupil.pupilId)
                          setPickerOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedPupilId === pupil.pupilId ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <div className="flex flex-col">
                          <span>{pupil.pupilName}</span>
                          {pupil.pupilEmail ? (
                            <span className="text-xs text-slate-500">{pupil.pupilEmail}</span>
                          ) : null}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!selectedPupilId || isPending} className="text-black">
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

(`cn` is the existing classname-merge helper from `@/lib/utils`, already used by every `components/ui/*` primitive read above — confirm it's exported from there; it is, since `command.tsx` and `popover.tsx` both import it from the same path.)

- [ ] **Step 2: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`

Expected: no new errors beyond the two pre-existing unrelated baseline errors in `tests/prototypes/fast-ui.spec.ts`. If `ReportsPupilListing`, `useToast`, or `cn` resolve to different export names than assumed above, fix the import to match what's actually exported — check `src/types/index.ts`, `src/components/ui/use-toast.ts`, and `src/lib/utils.ts` respectively if this step surfaces an import error.

- [ ] **Step 3: Self-review**

Confirm the new file compiles standalone (no missing imports) and that it's not yet wired into the page (that's Task 3) — so it won't be reachable from the UI yet, which is expected at this point.

- [ ] **Step 4: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/app/groups/[groupId]/add-member-dialog.tsx
git commit -m "Add AddMemberDialog component for admin pupil picker"
```

---

### Task 3: Wire `AddMemberDialog` into the group detail page, admin-gated

**Files:**
- Modify: `src/app/groups/[groupId]/page.tsx`

Current relevant lines:

```tsx
import { requireTeacherProfile } from "@/lib/auth"
```

```tsx
import type { PupilActionState } from "./pupil-action-state"
import { GroupPupilList, type PupilMember } from "./group-pupil-list"
import { ImportPupilsDialog } from "./import-pupils-dialog"
```

```tsx
  const teacherProfile = await requireTeacherProfile()
  const { groupId } = await params
```

```tsx
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Group</p>
              <ImportPupilsDialog targetGroupId={group.group_id} availableGroups={availableGroups} />
            </div>
```

- [ ] **Step 1: Update the `@/lib/auth` import**

Change:
```tsx
import { requireTeacherProfile } from "@/lib/auth"
```
to:
```tsx
import { hasRole, requireTeacherProfile } from "@/lib/auth"
```

- [ ] **Step 2: Import the new component**

Change:
```tsx
import type { PupilActionState } from "./pupil-action-state"
import { GroupPupilList, type PupilMember } from "./group-pupil-list"
import { ImportPupilsDialog } from "./import-pupils-dialog"
```
to:
```tsx
import type { PupilActionState } from "./pupil-action-state"
import { GroupPupilList, type PupilMember } from "./group-pupil-list"
import { ImportPupilsDialog } from "./import-pupils-dialog"
import { AddMemberDialog } from "./add-member-dialog"
```

- [ ] **Step 3: Compute `isAdmin`**

Change:
```tsx
  const teacherProfile = await requireTeacherProfile()
  const { groupId } = await params
```
to:
```tsx
  const teacherProfile = await requireTeacherProfile()
  const isAdmin = hasRole(teacherProfile, "admin")
  const { groupId } = await params
```

- [ ] **Step 4: Render the dialog conditionally next to `ImportPupilsDialog`**

Change:
```tsx
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Group</p>
              <ImportPupilsDialog targetGroupId={group.group_id} availableGroups={availableGroups} />
            </div>
```
to:
```tsx
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Group</p>
              <div className="flex items-center gap-2">
                {isAdmin ? <AddMemberDialog groupId={group.group_id} /> : null}
                <ImportPupilsDialog targetGroupId={group.group_id} availableGroups={availableGroups} />
              </div>
            </div>
```

No other change to this file — all existing handlers, the member list, and the import dialog stay exactly as they are.

- [ ] **Step 5: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`

Expected: no new errors beyond the two pre-existing unrelated baseline errors in `tests/prototypes/fast-ui.spec.ts`.

- [ ] **Step 6: Self-review**

`git diff src/app/groups/[groupId]/page.tsx` — confirm the diff matches exactly the four changes above (import line, new import, `isAdmin` computation, conditional render), nothing else touched.

- [ ] **Step 7: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add "src/app/groups/[groupId]/page.tsx"
git commit -m "Show AddMemberDialog on group page for admins only"
```

---

### Task 4: Manual end-to-end verification

**No files changed in this task — verification only.**

- [ ] **Step 1: Start the dev server (if not already running)**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npm run dev`

- [ ] **Step 2: Verify admin can add a pupil**

1. Sign in as a user with the `admin` role.
2. Navigate to `/groups/<some-group-id>`.
3. Confirm an "Add Member" button appears next to "Import Pupils" in the header.
4. Open it, type part of a pupil's name who is NOT currently in this group — confirm they appear in the dropdown list with their email shown underneath their name.
5. Select them, click "Add Member" in the dialog footer — confirm a success toast appears, the dialog closes, and the pupil now appears in the "Members" list on the page.
6. Re-open the dialog — confirm that pupil no longer appears in the picker's list (they're now a member, so they're filtered out).
7. Confirm no teacher accounts ever appear in the picker's list, regardless of search term.

- [ ] **Step 3: Verify non-admin teacher does not see the control**

1. Sign in as a regular teacher (no `admin` role) who has access to a group's page.
2. Navigate to `/groups/<that-group-id>`.
3. Confirm there is no "Add Member" button — only "Import Pupils" appears, exactly as before this change.

- [ ] **Step 4: Verify server-side rejection of a non-admin tampering attempt**

1. While signed in as the non-admin teacher from Step 3, open the browser console and call `addGroupMemberAction({ groupId: "<that-group-id>", userId: "<some-pupil-id>" })` directly (it's exposed as a server action reference if imported, or simulate by checking the code path).
2. Confirm it returns `{ success: false, error: "You do not have permission to add pupils." }` and does not insert a row into `group_membership` — i.e. the pupil does not appear in the group afterward.
