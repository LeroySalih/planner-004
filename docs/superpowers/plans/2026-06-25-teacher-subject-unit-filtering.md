# Teacher-Subject Association & Planner Unit Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins assign teachers to subjects from a new admin page, and use that association to scope the teacher planner's unit picker to only the units matching the teacher's assigned subjects.

**Architecture:** A new `teacher_subjects` many-to-many junction table (`user_id`, `subject`) backs three server actions (bulk admin read, single-teacher read, admin write) following the existing `src/lib/server-actions/subjects.ts` pattern exactly (the `query()` helper from `src/lib/db.ts`, `requireRole`/`requireTeacherProfile` guards, Zod-validated `{ data, error }` returns). A new admin page renders a teacher × subject checkbox grid. The teacher-planner page filters its existing unit list in-memory using the logged-in teacher's subjects, with admins bypassing the filter entirely.

**Tech Stack:** Next.js 15 App Router, TypeScript, Zod, `pg` via `src/lib/db.ts`, React 19 client components, `sonner` toasts, Tailwind v4 with CSS variable tokens (`var(--color-...)`), Radix-wrapped `Button` from `src/components/ui/button`.

## Global Constraints

- Two-space indentation throughout (CLAUDE.md).
- Server actions: validate with Zod, wrap calls in try/catch, return `{ data, error }` (CLAUDE.md).
- Don't add features/abstractions beyond what's specified — no `active` column on `teacher_subjects`, no self-service editing path (spec).
- Dates/formatting: not applicable to this feature.
- No backwards-compatibility hacks; delete rather than comment out (CLAUDE.md).
- SQL: nullable booleans must use `IS NOT FALSE`, not `= true` — not applicable here since `teacher_subjects` has no boolean columns, but `is_teacher` checks elsewhere in this plan must respect existing patterns in `auth.ts`/`profile.ts`.
- Migration files live in `src/migrations/`, applied manually via `psql "$DATABASE_URL" -f <file>` (project convention — no automated runner).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/migrations/20260625_teacher_subjects.sql` | Create `teacher_subjects` table |
| `src/lib/server-actions/teacher-subjects.ts` | `readTeacherSubjectsAction`, `readAllTeacherSubjectsAction`, `updateTeacherSubjectsAction` |
| `src/lib/server-updates.ts` | Re-export the three new actions |
| `src/components/admin/teacher-subject-manager.tsx` | Client component: teacher × subject checkbox grid |
| `src/app/admin/teacher-subjects/page.tsx` | Admin page wiring data fetch → component |
| `src/app/admin/page.tsx` | Add nav card linking to the new admin page |
| `src/app/teacher-planner/page.tsx` | Fetch logged-in teacher's subjects, filter units before passing to client |

---

### Task 1: Migration — `teacher_subjects` table

**Files:**
- Create: `src/migrations/20260625_teacher_subjects.sql`

**Interfaces:**
- Produces: table `public.teacher_subjects(user_id text, subject text)`, PK `(user_id, subject)`, FK `user_id → profiles(user_id) ON DELETE CASCADE`, FK `subject → subjects(subject) ON DELETE CASCADE`.

- [ ] **Step 1: Write the migration file**

```sql
-- 20260625_teacher_subjects.sql
-- Many-to-many association between teachers (profiles) and subjects,
-- used to scope which units appear in the teacher planner's unit picker.

CREATE TABLE IF NOT EXISTS public.teacher_subjects (
  user_id text NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  subject text NOT NULL REFERENCES public.subjects(subject) ON DELETE CASCADE,
  PRIMARY KEY (user_id, subject)
);
```

- [ ] **Step 2: Apply the migration to the local dev database**

Run: `psql "$DATABASE_URL" -f src/migrations/20260625_teacher_subjects.sql`
Expected output: `CREATE TABLE`

- [ ] **Step 3: Verify the table exists with correct constraints**

Run: `psql "$DATABASE_URL" -c "\d teacher_subjects"`
Expected: shows columns `user_id text`, `subject text`, primary key on `(user_id, subject)`, and two foreign-key constraints referencing `profiles` and `subjects`.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/20260625_teacher_subjects.sql
git commit -m "Add teacher_subjects junction table migration"
```

---

### Task 2: Server actions — read/write teacher-subject associations

**Files:**
- Create: `src/lib/server-actions/teacher-subjects.ts`
- Modify: `src/lib/server-updates.ts:111` (insert new export block after the existing `subjects` export block, before the `unit-files` export block)

**Interfaces:**
- Consumes: `requireRole`, `requireTeacherProfile`, `type AuthenticatedProfile` from `@/lib/auth`; `query` from `@/lib/db`.
- Produces:
  - `readTeacherSubjectsAction(options?: { userId?: string; currentProfile?: AuthenticatedProfile | null }): Promise<{ data: string[] | null; error: string | null }>`
  - `readAllTeacherSubjectsAction(): Promise<{ data: { userId: string; subject: string }[] | null; error: string | null }>`
  - `updateTeacherSubjectsAction(userId: string, subjects: string[]): Promise<{ data: null; error: string | null }>`

- [ ] **Step 1: Write the implementation**

```typescript
"use server"

import { z } from "zod"

import { requireRole, requireTeacherProfile, type AuthenticatedProfile } from "@/lib/auth"
import { query, withDbClient } from "@/lib/db"

const TeacherSubjectsResult = z.object({
  data: z.array(z.string()).nullable(),
  error: z.string().nullable(),
})

const AllTeacherSubjectsResult = z.object({
  data: z
    .array(
      z.object({
        userId: z.string(),
        subject: z.string(),
      }),
    )
    .nullable(),
  error: z.string().nullable(),
})

const TeacherSubjectsWriteResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

export async function readTeacherSubjectsAction(options?: {
  userId?: string
  currentProfile?: AuthenticatedProfile | null
}): Promise<z.infer<typeof TeacherSubjectsResult>> {
  try {
    const profile = options?.currentProfile ?? (await requireTeacherProfile())
    const targetUserId = options?.userId ?? profile.userId

    const { rows } = await query<{ subject: string }>(
      `SELECT subject FROM teacher_subjects WHERE user_id = $1 ORDER BY subject ASC`,
      [targetUserId],
    )

    return TeacherSubjectsResult.parse({ data: rows.map((r) => r.subject), error: null })
  } catch (e) {
    return TeacherSubjectsResult.parse({ data: null, error: String(e) })
  }
}

export async function readAllTeacherSubjectsAction(): Promise<z.infer<typeof AllTeacherSubjectsResult>> {
  try {
    await requireRole("admin")

    const { rows } = await query<{ user_id: string; subject: string }>(
      `SELECT user_id, subject FROM teacher_subjects ORDER BY user_id ASC, subject ASC`,
    )

    return AllTeacherSubjectsResult.parse({
      data: rows.map((r) => ({ userId: r.user_id, subject: r.subject })),
      error: null,
    })
  } catch (e) {
    return AllTeacherSubjectsResult.parse({ data: null, error: String(e) })
  }
}

export async function updateTeacherSubjectsAction(
  userId: string,
  subjects: string[],
): Promise<z.infer<typeof TeacherSubjectsWriteResult>> {
  try {
    await requireRole("admin")

    if (!userId.trim()) {
      return TeacherSubjectsWriteResult.parse({ data: null, error: "A teacher must be specified." })
    }

    await withDbClient(async (client) => {
      await client.query("BEGIN")
      try {
        await client.query(`DELETE FROM teacher_subjects WHERE user_id = $1`, [userId])

        for (const subject of subjects) {
          await client.query(
            `INSERT INTO teacher_subjects (user_id, subject) VALUES ($1, $2)`,
            [userId, subject],
          )
        }

        await client.query("COMMIT")
      } catch (innerError) {
        await client.query("ROLLBACK")
        throw innerError
      }
    })

    return TeacherSubjectsWriteResult.parse({ data: null, error: null })
  } catch (e) {
    return TeacherSubjectsWriteResult.parse({ data: null, error: String(e) })
  }
}
```

- [ ] **Step 2: Add the re-export block to `server-updates.ts`**

In `src/lib/server-updates.ts`, after line 111 (the closing `} from "./server-actions/subjects";` line) and before the `unit-files` export block, insert:

```typescript
export {
  readTeacherSubjectsAction,
  readAllTeacherSubjectsAction,
  updateTeacherSubjectsAction,
} from "./server-actions/teacher-subjects";
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no new errors related to `teacher-subjects.ts` or `server-updates.ts`.

- [ ] **Step 4: Manual verification via a scratch script or psql**

Run: `psql "$DATABASE_URL" -c "INSERT INTO teacher_subjects (user_id, subject) SELECT user_id, (SELECT subject FROM subjects LIMIT 1) FROM profiles WHERE is_teacher = true LIMIT 1;"`
Then run: `psql "$DATABASE_URL" -c "SELECT * FROM teacher_subjects;"`
Expected: one row returned, confirming the FK constraints accepted real `profiles`/`subjects` data. Clean up afterward: `psql "$DATABASE_URL" -c "DELETE FROM teacher_subjects;"`

- [ ] **Step 5: Commit**

```bash
git add src/lib/server-actions/teacher-subjects.ts src/lib/server-updates.ts
git commit -m "Add teacher-subjects server actions for admin assignment and planner filtering"
```

---

### Task 3: Admin page — teacher × subject assignment grid

**Files:**
- Create: `src/components/admin/teacher-subject-manager.tsx`
- Create: `src/app/admin/teacher-subjects/page.tsx`
- Modify: `src/app/admin/page.tsx` (add a nav card)

**Interfaces:**
- Consumes: `readAllProfilesAction` (returns `{ userId, email, firstName, lastName, roles }[]`) from `@/lib/server-actions/profile`; `readAllSubjectsAction` (returns `Subject[]` with `{ subject, active }`) and `readAllTeacherSubjectsAction`, `updateTeacherSubjectsAction` from `@/lib/server-updates`.
- Produces: route `/admin/teacher-subjects`.

- [ ] **Step 1: Write the client component**

```tsx
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { updateTeacherSubjectsAction } from '@/lib/server-updates'

type TeacherRow = {
  userId: string
  displayName: string
}

type Props = {
  teachers: TeacherRow[]
  subjects: string[]
  initialAssignments: Map<string, string[]>
}

export function TeacherSubjectManager({ teachers, subjects, initialAssignments }: Props) {
  const [assignments, setAssignments] = useState<Map<string, string[]>>(initialAssignments)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  async function handleToggle(userId: string, subject: string, checked: boolean) {
    const current = assignments.get(userId) ?? []
    const next = checked ? [...current, subject] : current.filter((s) => s !== subject)

    const key = `${userId}::${subject}`
    setSavingKey(key)
    const { error } = await updateTeacherSubjectsAction(userId, next)
    setSavingKey(null)

    if (error) {
      toast.error(error)
      return
    }

    setAssignments((prev) => {
      const updated = new Map(prev)
      updated.set(userId, next)
      return updated
    })
    toast.success(checked ? `Added ${subject}` : `Removed ${subject}`)
  }

  if (teachers.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">No teacher profiles found.</p>
  }

  if (subjects.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">No active subjects configured yet.</p>
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="px-4 py-2 text-left font-medium text-[var(--color-text-primary)]">Teacher</th>
            {subjects.map((subject) => (
              <th key={subject} className="px-4 py-2 text-center font-medium text-[var(--color-text-primary)]">
                {subject}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teachers.map((teacher) => {
            const teacherSubjects = assignments.get(teacher.userId) ?? []
            return (
              <tr key={teacher.userId} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-[var(--color-text-primary)]">{teacher.displayName}</td>
                {subjects.map((subject) => {
                  const key = `${teacher.userId}::${subject}`
                  return (
                    <td key={key} className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={teacherSubjects.includes(subject)}
                        disabled={savingKey === key}
                        onChange={(e) => handleToggle(teacher.userId, subject, e.target.checked)}
                      />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Write the page**

```tsx
import { readAllProfilesAction } from '@/lib/server-actions/profile'
import { readAllSubjectsAction, readAllTeacherSubjectsAction } from '@/lib/server-updates'
import { TeacherSubjectManager } from '@/components/admin/teacher-subject-manager'

export default async function TeacherSubjectsPage() {
  const [profilesResult, subjectsResult, assignmentsResult] = await Promise.all([
    readAllProfilesAction(),
    readAllSubjectsAction(),
    readAllTeacherSubjectsAction(),
  ])

  const teachers = (profilesResult.data ?? [])
    .filter((p) => p.roles.includes('teacher'))
    .map((p) => ({
      userId: p.userId,
      displayName: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || p.userId,
    }))

  const activeSubjects = (subjectsResult.data ?? [])
    .filter((s) => s.active)
    .map((s) => s.subject)

  const assignmentMap = new Map<string, string[]>()
  for (const row of assignmentsResult.data ?? []) {
    const existing = assignmentMap.get(row.userId) ?? []
    existing.push(row.subject)
    assignmentMap.set(row.userId, existing)
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Teacher Subjects</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Assign subjects to teachers. The teacher planner only shows units matching a teacher&apos;s assigned subjects.
        </p>
      </div>
      <TeacherSubjectManager
        teachers={teachers}
        subjects={activeSubjects}
        initialAssignments={assignmentMap}
      />
    </div>
  )
}
```

- [ ] **Step 3: Confirm `readAllProfilesAction` profile shape matches what Step 2 assumes**

Run: `grep -n "roles:" -A 2 src/lib/server-actions/profile.ts | head -10`
Expected: confirms each returned profile has a `roles: string[]` field (as seen in `readAllProfilesAction` at `src/lib/server-actions/profile.ts:428-434`) and `email`, `firstName`, `lastName`, `userId` fields. If field names differ from what Step 2 assumes, adjust the page's mapping to match exactly.

- [ ] **Step 4: Add a nav card to the admin dashboard**

In `src/app/admin/page.tsx`, add `GraduationCap` is already imported — reuse `Users` icon (already imported) for this card. Insert after the `/admin/subjects` card (after line 79, before the closing `</div>` on line 80):

```tsx
      <Link href="/admin/teacher-subjects">
        <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Teacher Subjects</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Assign</div>
            <p className="text-xs text-muted-foreground">Link teachers to the subjects they teach</p>
          </CardContent>
        </Card>
      </Link>
```

- [ ] **Step 5: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors in the three touched/created files.

- [ ] **Step 6: Manually verify in the browser**

Run: `pnpm dev`, sign in as an admin, navigate to `/admin/teacher-subjects`.
Expected: a table with one row per teacher profile and one column per active subject; checking a box persists (toast confirms), and reloading the page shows the checkbox still checked.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/teacher-subject-manager.tsx src/app/admin/teacher-subjects/page.tsx src/app/admin/page.tsx
git commit -m "Add admin page for assigning teachers to subjects"
```

---

### Task 4: Filter planner units by the logged-in teacher's subjects

**Files:**
- Modify: `src/app/teacher-planner/page.tsx`

**Interfaces:**
- Consumes: `readTeacherSubjectsAction` from `@/lib/server-updates` (added in Task 2); existing `readUnitsAction`, `readGroupsAction`, `readTeachersAction`; `Unit` type (`{ unit_id, title, subject, description, year, active }`) from `@/types`.
- Produces: `units` prop passed to `<TeacherPlannerClient>` is now filtered for non-admin teachers.

- [ ] **Step 1: Re-read the current page to confirm exact line numbers before editing**

Run: `cat -n src/app/teacher-planner/page.tsx`

- [ ] **Step 2: Add the subject fetch and filtering logic**

Replace this block:

```typescript
import { readGroupsAction, readUnitsAction, readTeachersAction } from '@/lib/server-updates'
import { requireTeacherProfile, hasRole } from '@/lib/auth'
import { TeacherPlannerClient } from '@/components/teacher-planner/TeacherPlannerClient'

export default async function TeacherPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; teacherId?: string }>
}) {
  const profile = await requireTeacherProfile()
  const isAdmin = hasRole(profile, 'admin')
  const { week, teacherId } = await searchParams

  const [groupsResult, unitsResult, teachersResult] = await Promise.all([
    readGroupsAction(),
    readUnitsAction(),
    readTeachersAction(),
  ])

  if (groupsResult.error || unitsResult.error) {
    return (
      <div className="max-w-[95%] mx-auto p-8 text-sm text-red-600">
        Failed to load planner data.
        {groupsResult.error && <p>{groupsResult.error}</p>}
        {unitsResult.error && <p>{unitsResult.error}</p>}
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--color-background-tertiary)] p-8">
      <TeacherPlannerClient
        units={unitsResult.data ?? []}
        groups={groupsResult.data ?? []}
        teachers={teachersResult.data ?? []}
        currentTeacherId={profile.userId}
        isAdmin={isAdmin}
        initialWeek={week}
        initialSelectedTeacherId={teacherId}
      />
    </main>
  )
}
```

with:

```typescript
import { readGroupsAction, readUnitsAction, readTeachersAction, readTeacherSubjectsAction } from '@/lib/server-updates'
import { requireTeacherProfile, hasRole } from '@/lib/auth'
import { TeacherPlannerClient } from '@/components/teacher-planner/TeacherPlannerClient'

export default async function TeacherPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; teacherId?: string }>
}) {
  const profile = await requireTeacherProfile()
  const isAdmin = hasRole(profile, 'admin')
  const { week, teacherId } = await searchParams

  const [groupsResult, unitsResult, teachersResult, teacherSubjectsResult] = await Promise.all([
    readGroupsAction(),
    readUnitsAction(),
    readTeachersAction(),
    readTeacherSubjectsAction({ currentProfile: profile }),
  ])

  if (groupsResult.error || unitsResult.error) {
    return (
      <div className="max-w-[95%] mx-auto p-8 text-sm text-red-600">
        Failed to load planner data.
        {groupsResult.error && <p>{groupsResult.error}</p>}
        {unitsResult.error && <p>{unitsResult.error}</p>}
      </div>
    )
  }

  const allUnits = unitsResult.data ?? []
  const teacherSubjects = teacherSubjectsResult.data ?? []
  const visibleUnits = isAdmin
    ? allUnits
    : allUnits.filter((unit) => teacherSubjects.includes(unit.subject))

  return (
    <main className="min-h-screen bg-[var(--color-background-tertiary)] p-8">
      <TeacherPlannerClient
        units={visibleUnits}
        groups={groupsResult.data ?? []}
        teachers={teachersResult.data ?? []}
        currentTeacherId={profile.userId}
        isAdmin={isAdmin}
        initialWeek={week}
        initialSelectedTeacherId={teacherId}
      />
    </main>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification — empty subject set**

As a teacher with no rows in `teacher_subjects`, sign in and visit `/teacher-planner`. Open the unit picker for any slot.
Expected: the unit dropdown shows no units.

- [ ] **Step 5: Manual verification — matching subject**

As an admin, go to `/admin/teacher-subjects` and check one subject (matching at least one existing unit's `subject`) for that teacher. Reload `/teacher-planner` as that teacher.
Expected: the unit dropdown shows only units whose `subject` matches the assigned subject(s).

- [ ] **Step 6: Manual verification — admin bypass**

Sign in as an admin (who may have zero `teacher_subjects` rows) and visit `/teacher-planner`.
Expected: the unit dropdown shows all active units, unaffected by the admin's own subject associations.

- [ ] **Step 7: Commit**

```bash
git add src/app/teacher-planner/page.tsx
git commit -m "Filter teacher planner unit picker by teacher's assigned subjects"
```

---

## Spec Coverage Check

- Many-to-many `teacher_subjects` table → Task 1.
- Admin-only assignment UI (not profile self-service) → Task 3.
- `readTeacherSubjectsAction`, `readAllTeacherSubjectsAction`, `updateTeacherSubjectsAction` → Task 2.
- Curricula-to-subjects link confirmed pre-existing (no schema work needed) → covered in design doc, no implementation task required.
- Planner filtering scoped to logged-in teacher, admin bypass, empty-set-means-empty-list → Task 4.
- Manual test scenarios from spec's Testing section → Steps 4–6 of Task 4 and Step 6 of Task 3.
