# Pupil Parent Email Fields Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `father_email` and `mother_email` fields to pupil profiles, editable inline from the `/reports` table with on-blur auto-save.

**Architecture:** A SQL migration adds two nullable columns to `profiles`; the existing enrichment query in `listPupilsWithGroupsAction` is extended to fetch them; a new server action handles writes; and the reports table gains two editable input columns via a `ParentEmailCell` component.

**Tech Stack:** PostgreSQL (via `pg` pool), Next.js 15 App Router server actions, Zod, React (`useState`/`useRef`/`useTransition`), Tailwind CSS v4, sonner toasts.

**Spec:** `docs/superpowers/specs/2026-03-16-pupil-parent-emails-design.md`

---

## Chunk 1: Data Layer

### Task 1: SQL Migration

**Files:**
- Create: `src/migrations/067-add-parent-emails.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 067-add-parent-emails.sql
ALTER TABLE profiles ADD COLUMN father_email text;
ALTER TABLE profiles ADD COLUMN mother_email text;
```

- [ ] **Step 2: Apply the migration to the worktree database**

Run from inside `.worktrees/pupil-details/`:
```bash
PGPASSWORD="your-super-secret-and-long-postgres-password" psql -h localhost -U postgres -d postgres-pupil-details -f src/migrations/067-add-parent-emails.sql
```

Expected output:
```
ALTER TABLE
ALTER TABLE
```

- [ ] **Step 3: Verify columns exist**

```bash
PGPASSWORD="your-super-secret-and-long-postgres-password" psql -h localhost -U postgres -d postgres-pupil-details -c "\d profiles" | grep email
```

Expected: lines for `father_email` and `mother_email` alongside the existing `email` column.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/067-add-parent-emails.sql
git commit -m "feat: add father_email and mother_email columns to profiles"
```

---

### Task 2: Extend Zod Schema

**Files:**
- Modify: `src/types/index.ts:100-106`

- [ ] **Step 1: Add `fatherEmail` and `motherEmail` to `ReportsPupilListingSchema`**

In `src/types/index.ts`, replace lines 100–106:

```ts
export const ReportsPupilListingSchema = z.object({
    pupilId: z.string(),
    pupilName: z.string(),
    pupilEmail: z.string().email().nullable().optional(),
    isTeacher: z.boolean().default(false),
    groups: z.array(ReportsPupilGroupSchema),
    fatherEmail: z.string().email().nullable().optional(),
    motherEmail: z.string().email().nullable().optional(),
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add fatherEmail and motherEmail to ReportsPupilListingSchema"
```

---

### Task 3: Extend Data Enrichment in `listPupilsWithGroupsAction`

**Files:**
- Modify: `src/lib/server-actions/groups.ts:384-398`

- [ ] **Step 1: Extend the enrichment `query()` call to fetch parent emails**

In `src/lib/server-actions/groups.ts`, replace the inner `query` call and the forEach that follows (lines 384–398):

```ts
      const { rows: profileRows } = await query<
        { user_id: string; email: string | null; is_teacher: boolean | null; father_email: string | null; mother_email: string | null }
      >(
        "select user_id, email, is_teacher, father_email, mother_email from profiles where user_id = any($1::text[])",
        [pupilIds],
      );
      const emailMap = new Map(profileRows.map((r) => [r.user_id, r.email]));
      const teacherMap = new Map(
        profileRows.map((r) => [r.user_id, r.is_teacher]),
      );
      const fatherEmailMap = new Map(profileRows.map((r) => [r.user_id, r.father_email]));
      const motherEmailMap = new Map(profileRows.map((r) => [r.user_id, r.mother_email]));

      rawData.forEach((p: any) => {
        p.pupilEmail = emailMap.get(p.pupilId) ?? null;
        p.isTeacher = teacherMap.get(p.pupilId) ?? false;
        p.fatherEmail = fatherEmailMap.get(p.pupilId) ?? null;
        p.motherEmail = motherEmailMap.get(p.pupilId) ?? null;
      });
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke-test the action via the running dev server**

Open `http://localhost:3001/reports` in a browser. The page should load without errors (check browser console and server logs). Parent email columns won't appear yet — that's expected.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server-actions/groups.ts
git commit -m "feat: extend listPupilsWithGroupsAction to include parent emails"
```

---

### Task 4: Write `updatePupilParentEmailAction` Server Action

**Files:**
- Modify: `src/lib/server-actions/groups.ts` (append near end of file, before last closing brace or after `listPupilsWithGroupsAction`)
- Modify: `src/lib/server-updates.ts`

- [ ] **Step 1: Add `requireTeacherProfile` to the auth import in `groups.ts`**

In `src/lib/server-actions/groups.ts`, find the auth import block at lines 18–23 and add `requireTeacherProfile`:

```ts
import {
  type AuthenticatedProfile as BaseAuthenticatedProfile,
  getAuthenticatedProfile,
  hashPassword,
  requireAuthenticatedProfile,
  requireTeacherProfile,
} from "@/lib/auth";
```

- [ ] **Step 2: Add the server action to `groups.ts`**

Append the following function to `src/lib/server-actions/groups.ts` (after `listPupilsWithGroupsAction`, before the next exported function):

```ts
export async function updatePupilParentEmailAction(
  pupilId: string,
  field: 'father_email' | 'mother_email',
  value: string | null,
): Promise<{ data: null; error: string | null }> {
  await requireTeacherProfile();
  // Note: requireTeacherProfile() calls redirect() internally when the user is
  // not authenticated or lacks the teacher role. Do NOT wrap this in try/catch —
  // Next.js redirect() throws a special error that must propagate to the framework.

  const parsed = z.string().email().nullable().safeParse(value);
  if (!parsed.success) {
    return { data: null, error: "Invalid email address." };
  }

  const sql =
    field === 'father_email'
      ? 'UPDATE profiles SET father_email = $2 WHERE user_id = $1 AND is_teacher = false'
      : 'UPDATE profiles SET mother_email = $2 WHERE user_id = $1 AND is_teacher = false';

  try {
    const result = await query(sql, [pupilId, parsed.data]);
    if (result.rowCount === 0) {
      return { data: null, error: "Pupil not found." };
    }
    return { data: null, error: null };
  } catch (error) {
    console.error("[reports] Failed to update parent email", error);
    return { data: null, error: "Failed to save." };
  }
}
```

> Note: `query` and `z` are already imported at the top of this file.

- [ ] **Step 3: Re-export from `src/lib/server-updates.ts`**

In `src/lib/server-updates.ts`, add `updatePupilParentEmailAction` to the groups export block (lines 1–19):

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

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server-actions/groups.ts src/lib/server-updates.ts
git commit -m "feat: add updatePupilParentEmailAction server action"
```

---

## Chunk 2: UI Layer

### Task 5: Update Reports Page and Table Types

**Files:**
- Modify: `src/app/reports/page.tsx`
- Modify: `src/app/reports/reports-table.tsx:11-17`

- [ ] **Step 1: Add `fatherEmail` and `motherEmail` to `ReportsTablePupil` type**

In `src/app/reports/reports-table.tsx`, replace lines 11–17:

```ts
export type ReportsTablePupil = {
  pupilId: string
  name: string
  email?: string | null
  isTeacher: boolean
  groups: string[]
  fatherEmail?: string | null
  motherEmail?: string | null
}
```

- [ ] **Step 2: Pass fields through in the page mapping**

In `src/app/reports/page.tsx`, replace the `.map()` block (lines 22–28):

```ts
  const pupils = pupilListings.map((listing) => ({
    pupilId: listing.pupilId,
    name: listing.pupilName,
    email: listing.pupilEmail,
    isTeacher: listing.isTeacher,
    groups: listing.groups.map((group) => group.group_id).sort((a, b) => a.localeCompare(b)),
    fatherEmail: listing.fatherEmail,
    motherEmail: listing.motherEmail,
  }))
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/reports/page.tsx src/app/reports/reports-table.tsx
git commit -m "feat: thread fatherEmail and motherEmail through to reports table props"
```

---

### Task 6: Add `ParentEmailCell` Component and Table Columns

**Files:**
- Modify: `src/app/reports/reports-table.tsx`

- [ ] **Step 1: Add the import for `updatePupilParentEmailAction` at top of `reports-table.tsx`**

In `src/app/reports/reports-table.tsx`, replace line 9:

```ts
// old:
import { toggleUserTeacherStatusAction } from "@/lib/server-updates"
// new:
import { toggleUserTeacherStatusAction, updatePupilParentEmailAction } from "@/lib/server-updates"
```

- [ ] **Step 2: Add `useRef` to the React import**

In `src/app/reports/reports-table.tsx`, replace line 3:

```ts
// old:
import { useMemo, useState, useTransition } from "react"
// new:
import { useMemo, useRef, useState, useTransition } from "react"
```

- [ ] **Step 3: Add two new `<th>` columns to the table header**

In `reports-table.tsx`, find the `<thead>` block and add two columns after the existing `Email` column header and before `Is Teacher`:

```tsx
              <th className="border border-border px-4 py-2 text-left">Email</th>
              <th className="border border-border px-4 py-2 text-left">Father&apos;s Email</th>
              <th className="border border-border px-4 py-2 text-left">Mother&apos;s Email</th>
              <th className="border border-border px-4 py-2 text-left">Is Teacher</th>
              <th className="border border-border px-4 py-2 text-left">Groups</th>
```

- [ ] **Step 4: Update the empty-state `colSpan` from 4 to 6**

Find the empty state row (currently `colSpan={4}`) and update:

```tsx
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">
```

- [ ] **Step 5: Add two `<td>` cells per pupil row for parent emails**

In the `filtered.map((pupil) => ...)` body, add two new cells after the `email` cell and before the `isTeacher` cell:

```tsx
                  <td className="border border-border px-4 py-2 align-top text-muted-foreground">
                    <ParentEmailCell
                      pupilId={pupil.pupilId}
                      field="father_email"
                      initialValue={pupil.fatherEmail}
                    />
                  </td>
                  <td className="border border-border px-4 py-2 align-top text-muted-foreground">
                    <ParentEmailCell
                      pupilId={pupil.pupilId}
                      field="mother_email"
                      initialValue={pupil.motherEmail}
                    />
                  </td>
```

- [ ] **Step 6: Add the `ParentEmailCell` component at the bottom of the file**

Append after the closing of `TeacherToggle`:

```tsx
function ParentEmailCell({
  pupilId,
  field,
  initialValue,
}: {
  pupilId: string
  field: 'father_email' | 'mother_email'
  initialValue: string | null | undefined
}) {
  const [value, setValue] = useState(initialValue ?? "")
  const savedValue = useRef(initialValue ?? "")
  const [isPending, startTransition] = useTransition()

  const handleBlur = () => {
    const trimmed = value.trim()
    if (trimmed === savedValue.current) return
    const valueOrNull = trimmed === "" ? null : trimmed
    startTransition(async () => {
      const result = await updatePupilParentEmailAction(pupilId, field, valueOrNull)
      if (!result.error) {
        savedValue.current = trimmed
        toast.success("Saved")
      } else {
        setValue(savedValue.current)
        toast.error(result.error ?? "Failed to save")
      }
    })
  }

  return (
    <input
      type="email"
      autoComplete="off"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      disabled={isPending}
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
    />
  )
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Smoke-test in the browser**

Open `http://localhost:3001/reports`. Verify:
- Two new columns appear: "Father's Email" and "Mother's Email"
- Each cell shows an empty input
- Tabbing out of an empty input fires no action (no toast)
- Typing a valid email and tabbing out shows a "Saved" toast
- Typing an invalid email and tabbing out shows an error toast and reverts the value
- Check browser console and server terminal for errors

- [ ] **Step 9: Commit**

```bash
git add src/app/reports/reports-table.tsx
git commit -m "feat: add Father's Email and Mother's Email editable columns to reports table"
```
