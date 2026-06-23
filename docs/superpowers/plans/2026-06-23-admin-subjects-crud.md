# Admin Subjects CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins add new subjects and toggle a subject's active/inactive flag from `/admin/subjects`, without supporting rename or hard delete.

**Architecture:** Three new server actions in the existing `src/lib/server-actions/subjects.ts`, re-exported from `src/lib/server-updates.ts`. A new admin page (`src/app/admin/subjects/page.tsx`) renders a new client component (`src/components/admin/SubjectManager.tsx`) modeled directly on the existing `src/components/admin/SchoolYearManager.tsx`. A new card on `/admin` links to the page.

**Tech Stack:** Next.js 15 App Router, React 19 Server/Client Components, TypeScript, Zod, `pg` via `src/lib/db.ts`'s `query()` helper, Tailwind CSS v4, `sonner` toasts.

---

## Spec reference

Design doc: `docs/superpowers/specs/2026-06-23-admin-subjects-crud-design.md`

## Background for the engineer

The `subjects` table (`src/migrations/schema.sql`) is:

```sql
CREATE TABLE public.subjects (
    subject text NOT NULL,
    active boolean DEFAULT true
);
```

There's no primary key or unique constraint on `subject`, and no foreign key from `units.subject` or `curricula.subject` to this table — they're matched by plain text value. Per the design decision, this plan does NOT support renaming a subject (it would silently orphan unit/curriculum references) and does NOT support hard delete — only adding new subjects and toggling `active`.

The existing `src/lib/server-actions/subjects.ts` already has `readSubjectsAction` (teacher-facing, returns only `active = true` subjects, used elsewhere in the app — e.g. flashcards, pupil units). Do not modify it. You're adding three new admin-only actions alongside it.

`src/types/index.ts` already defines:

```ts
export const SubjectSchema = z.object({
    subject: z.string().min(1).max(255),
    active: z.boolean().default(true),
});

export const SubjectsSchema = z.array(SubjectSchema);

export type Subject = z.infer<typeof SubjectSchema>;
export type Subjects = z.infer<typeof SubjectsSchema>;
```

No changes needed there — reuse `Subject`/`SubjectSchema`.

The closest existing pattern to copy is School Years (`src/lib/server-actions/school-years.ts`, `src/app/admin/school-years/page.tsx`, `src/components/admin/SchoolYearManager.tsx`). You will mirror its structure closely, adapted for subjects having no separate "label" field and no rename support.

This codebase has no unit test infrastructure (per `CLAUDE.md`: "No unit test infrastructure yet"). Verification is via `pnpm lint`, `npx tsc --noEmit -p .` (if `pnpm lint` is broken in your environment, `tsc` is an acceptable substitute — note this in your task report either way), and manual testing via the running dev server.

---

### Task 1: Add admin server actions for subjects

**Files:**
- Modify: `src/lib/server-actions/subjects.ts`

- [ ] **Step 1: Add the new admin-only actions**

Open `src/lib/server-actions/subjects.ts`. It currently starts with:

```ts
"use server"

import { z } from "zod"

import { SubjectsSchema } from "@/types"
import { Client } from "pg"
import { requireTeacherProfile, type AuthenticatedProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"
```

Change the import block to also pull in `requireRole` and the `query` helper, and `SubjectSchema`/`Subject` type:

```ts
"use server"

import { z } from "zod"

import { SubjectSchema, SubjectsSchema, type Subject } from "@/types"
import { Client } from "pg"
import { requireRole, requireTeacherProfile, type AuthenticatedProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"
import { query } from "@/lib/db"
```

At the end of the file (after the existing `readSubjectsAction` function's closing brace), append:

```ts

const SubjectsResult = z.object({
  data: z.array(SubjectSchema).nullable(),
  error: z.string().nullable(),
})

const SubjectWriteResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

export async function readAllSubjectsAction(): Promise<z.infer<typeof SubjectsResult>> {
  try {
    await requireRole("admin")
    const { rows } = await query<Record<string, unknown>>(
      `SELECT subject, active FROM subjects ORDER BY subject ASC`,
    )
    return SubjectsResult.parse({ data: rows.map((r) => SubjectSchema.parse(r)), error: null })
  } catch (e) {
    return SubjectsResult.parse({ data: null, error: String(e) })
  }
}

export async function createSubjectAction(subject: string): Promise<z.infer<typeof SubjectWriteResult>> {
  try {
    await requireRole("admin")
    const trimmed = subject.trim()
    if (!trimmed) {
      return SubjectWriteResult.parse({ data: null, error: "Subject name is required." })
    }
    const { rows: existing } = await query<{ subject: string }>(
      `SELECT subject FROM subjects WHERE lower(subject) = lower($1)`,
      [trimmed],
    )
    if (existing.length > 0) {
      return SubjectWriteResult.parse({ data: null, error: "This subject already exists." })
    }
    await query(`INSERT INTO subjects (subject, active) VALUES ($1, true)`, [trimmed])
    return SubjectWriteResult.parse({ data: null, error: null })
  } catch (e) {
    return SubjectWriteResult.parse({ data: null, error: String(e) })
  }
}

export async function setSubjectActiveAction(
  subject: string,
  active: boolean,
): Promise<z.infer<typeof SubjectWriteResult>> {
  try {
    await requireRole("admin")
    await query(`UPDATE subjects SET active = $2 WHERE subject = $1`, [subject, active])
    return SubjectWriteResult.parse({ data: null, error: null })
  } catch (e) {
    return SubjectWriteResult.parse({ data: null, error: String(e) })
  }
}
```

Note: `SubjectsSchema` import is kept because the existing `readSubjectsAction` further up the file still uses it — do not remove that import usage, only add to it as shown above. If your editor/linter flags `SubjectsSchema` as unused after your edit, check that you didn't accidentally remove its use in the pre-existing `SubjectsReturnValue` schema near the top of the file — it must still read `SubjectsSchema.nullable()` exactly as before.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p .`
Expected: no errors referencing `src/lib/server-actions/subjects.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-actions/subjects.ts
git commit -m "feat: add admin server actions to list, create, and toggle subjects"
```

---

### Task 2: Re-export the new actions from server-updates.ts

**Files:**
- Modify: `src/lib/server-updates.ts`

- [ ] **Step 1: Update the subjects export line**

Find this existing line:

```ts
export { readSubjectsAction } from "./server-actions/subjects";
```

Replace it with:

```ts
export {
  readSubjectsAction,
  readAllSubjectsAction,
  createSubjectAction,
  setSubjectActiveAction,
} from "./server-actions/subjects";
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p .`
Expected: no errors referencing `src/lib/server-updates.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-updates.ts
git commit -m "feat: re-export admin subjects actions from server-updates"
```

---

### Task 3: Build the SubjectManager client component

**Files:**
- Create: `src/components/admin/SubjectManager.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/admin/SubjectManager.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { createSubjectAction, setSubjectActiveAction } from '@/lib/server-updates'
import type { Subject } from '@/types'
import { Button } from '@/components/ui/button'

type Props = {
  initialSubjects: Subject[]
}

function sortSubjects(subjects: Subject[]): Subject[] {
  return [...subjects].sort((a, b) => a.subject.localeCompare(b.subject))
}

export function SubjectManager({ initialSubjects }: Props) {
  const [subjects, setSubjects] = useState<Subject[]>(sortSubjects(initialSubjects))
  const [newSubject, setNewSubject] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    const trimmed = newSubject.trim()
    if (!trimmed) {
      toast.error('Enter a subject name')
      return
    }
    if (subjects.find((s) => s.subject.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('This subject already exists')
      return
    }
    setSaving(true)
    const { error } = await createSubjectAction(trimmed)
    setSaving(false)
    if (error) {
      toast.error(error)
      return
    }
    setSubjects((prev) => sortSubjects([...prev, { subject: trimmed, active: true }]))
    setNewSubject('')
    toast.success(`Added ${trimmed}`)
  }

  async function handleToggleActive(subject: string, currentActive: boolean) {
    const { error } = await setSubjectActiveAction(subject, !currentActive)
    if (error) {
      toast.error(error)
      return
    }
    setSubjects((prev) =>
      prev.map((s) => (s.subject === subject ? { ...s, active: !currentActive } : s)),
    )
    toast.success(!currentActive ? 'Subject activated' : 'Subject deactivated')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Subject name e.g. Geography"
          value={newSubject}
          onChange={(e) => setNewSubject(e.target.value)}
          className="w-52 rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
        />
        <Button size="sm" onClick={handleAdd} disabled={saving || !newSubject}>
          Add subject
        </Button>
      </div>

      <div className="rounded-md border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
        {subjects.length === 0 && (
          <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">No subjects configured.</p>
        )}
        {subjects.map((s) => (
          <div key={s.subject} className="flex items-center justify-between px-4 py-3 gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span
                className={`text-sm font-medium ${s.active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] line-through'}`}
              >
                {s.subject}
              </span>
              {!s.active && (
                <span className="text-xs rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-tertiary)]">
                  inactive
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant={s.active ? 'ghost' : 'outline'}
                onClick={() => handleToggleActive(s.subject, s.active)}
              >
                {s.active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p .`
Expected: no errors referencing `src/components/admin/SubjectManager.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/SubjectManager.tsx
git commit -m "feat: add SubjectManager admin component"
```

---

### Task 4: Add the /admin/subjects page and dashboard link

**Files:**
- Create: `src/app/admin/subjects/page.tsx`
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/admin/subjects/page.tsx`:

```tsx
import { readAllSubjectsAction } from '@/lib/server-updates'
import { SubjectManager } from '@/components/admin/SubjectManager'

export default async function SubjectsPage() {
  const { data } = await readAllSubjectsAction()

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Subjects</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Add subjects or deactivate ones no longer in use. Only active subjects appear in subject pickers across the app.
        </p>
      </div>
      <SubjectManager initialSubjects={data ?? []} />
    </div>
  )
}
```

(The page itself doesn't need its own auth check — `src/app/admin/layout.tsx` already calls `requireRole("admin")` for every route under `/admin`, and `readAllSubjectsAction` independently calls `requireRole("admin")` too.)

- [ ] **Step 2: Add a dashboard card**

Open `src/app/admin/page.tsx`. The top of the file currently is:

```tsx
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, ShieldAlert, CalendarDays, GraduationCap } from "lucide-react"
```

Change the icon import line to add `BookOpen`:

```tsx
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, ShieldAlert, CalendarDays, GraduationCap, BookOpen } from "lucide-react"
```

Find the closing of the "Half Terms" card block (the last card in the grid):

```tsx
      <Link href="/admin/half-terms">
        <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Half Terms</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Configure</div>
            <p className="text-xs text-muted-foreground">Set H1–H6 dates per academic year</p>
          </CardContent>
        </Card>
      </Link>
    </div>
  )
}
```

Replace it with (adding a new "Subjects" card right after Half Terms, before the closing `</div>`):

```tsx
      <Link href="/admin/half-terms">
        <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Half Terms</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Configure</div>
            <p className="text-xs text-muted-foreground">Set H1–H6 dates per academic year</p>
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/subjects">
        <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Subjects</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Configure</div>
            <p className="text-xs text-muted-foreground">Add and deactivate subjects</p>
          </CardContent>
        </Card>
      </Link>
    </div>
  )
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p .`
Expected: no errors referencing `src/app/admin/subjects/page.tsx` or `src/app/admin/page.tsx`.

- [ ] **Step 4: Manual verification in the browser**

Run `pnpm dev` (or use whatever dev server is already running), sign in as an admin user, and:
- Visit `/admin` and confirm a "Subjects" card appears after "Half Terms" and links to `/admin/subjects`.
- Visit `/admin/subjects` and confirm the page lists all existing subjects (check against `SELECT subject, active FROM subjects` if you have DB access) including any inactive ones (struck through, "inactive" badge).
- Add a new subject (e.g. "Test Subject XYZ"), confirm it appears in the list immediately and persists after a page reload.
- Try adding the same subject again (any case, e.g. "test subject xyz") and confirm it's rejected with "This subject already exists."
- Click "Deactivate" on a subject, confirm it becomes struck-through with an "inactive" badge, and that the button now reads "Activate".
- Click "Activate" on that subject again, confirm it returns to normal styling.
- As a non-admin user (or by temporarily checking the route guard), confirm `/admin/subjects` is not accessible — this should already be true via the existing `requireRole("admin")` in `src/app/admin/layout.tsx`, just confirm you didn't accidentally bypass it.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/subjects/page.tsx src/app/admin/page.tsx
git commit -m "feat: add /admin/subjects page and dashboard link"
```

---

## Self-review notes (completed during planning)

- **Spec coverage:** admin-only `readAllSubjectsAction`/`createSubjectAction`/`setSubjectActiveAction` (Task 1), re-export (Task 2), `SubjectManager` UI with add + toggle-active, no edit/rename button, empty state (Task 3), `/admin/subjects` page and dashboard card (Task 4), case-insensitive duplicate rejection (Task 1 + mirrored client-side check in Task 3), soft-delete-only / no-rename decisions reflected throughout (no rename action or button exists anywhere in the plan).
- **Placeholder scan:** none — every step shows complete code.
- **Type consistency:** `Subject`/`SubjectSchema` (from `src/types/index.ts`, unchanged) used consistently across Task 1 (server actions), Task 3 (`SubjectManager` props/state), and Task 4 (page passes `data ?? []` typed as `Subject[]`). Action names (`readAllSubjectsAction`, `createSubjectAction`, `setSubjectActiveAction`) match exactly between Task 1's definitions, Task 2's re-export, and Task 3's imports.
