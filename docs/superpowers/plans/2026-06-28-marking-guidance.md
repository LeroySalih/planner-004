# Marking Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins define reusable, per-subject "Marking Guidance" templates, and let teachers select a single template on an Upload Worksheet activity to prepend to its free-text marking guidance before it's sent to the AI marking webhook.

**Architecture:** New `marking_guidances` table + Zod schema + admin CRUD server actions + admin page/component (mirrors the existing `subjects` admin pattern). `UploadWorksheetActivityBodySchema` gains an optional `markingGuidanceId`; the lesson activity editor gets a single-select dropdown scoped to the lesson's subject. `marking-queue.ts` resolves the selected guidance (even if soft-deleted) and prepends its content to the teacher's free text before calling the AI webhook.

**Tech Stack:** Next.js 15 App Router, TypeScript, Zod, `pg` via `src/lib/db.ts`, React 19 client components, `sonner` toasts, existing `RichTextEditor` component.

## Global Constraints

- Two-space indentation throughout (project convention).
- No hard delete for marking guidances — only soft delete via `active` boolean (per spec).
- Only one marking guidance may be selected per activity (no multi-select).
- This plan covers **Upload Worksheet only** — do not touch Upload Spreadsheet or Short Text Question schemas/editors.
- All server actions: Zod-validated, `{ data, error }` return shape, guarded with `requireRole("admin")` for admin CRUD actions (mirrors `src/lib/server-actions/subjects.ts`).
- Migration files follow `YYYYMMDD_description.sql` naming under `src/migrations/`.
- No unit test infrastructure exists in this project — verification is via `pnpm lint`, `pnpm build` (or `tsc --noEmit`), and manual exercise of the feature in the dev server. Do not introduce a test framework.

---

### Task 1: Database migration for `marking_guidances`

**Files:**
- Create: `src/migrations/20260628_marking_guidances.sql`

**Interfaces:**
- Produces: table `marking_guidances(id uuid PK, subject text FK→subjects.subject, title text, content text, active boolean default true, created_at timestamptz default now())`.

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS public.marking_guidances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL REFERENCES public.subjects(subject) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marking_guidances_subject_idx ON public.marking_guidances (subject);
```

- [ ] **Step 2: Apply the migration to the local dev database**

Run: `psql "$DATABASE_URL" -f src/migrations/20260628_marking_guidances.sql`
Expected: `CREATE TABLE` and `CREATE INDEX` printed, no errors.

- [ ] **Step 3: Verify the table exists**

Run: `psql "$DATABASE_URL" -c "\d marking_guidances"`
Expected: column list matching the CREATE TABLE above.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/20260628_marking_guidances.sql
git commit -m "feat: add marking_guidances table"
```

---

### Task 2: Zod schemas — `MarkingGuidance` and `UploadWorksheetActivityBodySchema` update

**Files:**
- Modify: `src/types/index.ts:23-31` (area near `SubjectSchema`) — add `MarkingGuidanceSchema` nearby.
- Modify: `src/types/index.ts:594-599` (`UploadWorksheetActivityBodySchema`).

**Interfaces:**
- Produces: `MarkingGuidanceSchema`, `MarkingGuidancesSchema`, `type MarkingGuidance`, `type MarkingGuidances`.
- Produces: `UploadWorksheetActivityBodySchema` now accepts optional `markingGuidanceId: string` and `markingGuidance` is optional (default `""`), with a `.refine()` requiring at least one of them to carry content.
- Consumed by: Task 3 (server actions), Task 5 (editor UI), Task 7 (marking-queue resolution).

- [ ] **Step 1: Add `MarkingGuidanceSchema` after `SubjectsSchema` (around line 28)**

```ts
export const MarkingGuidanceSchema = z.object({
    id: z.string(),
    subject: z.string().min(1).max(255),
    title: z.string().min(1),
    content: z.string().min(1),
    active: z.boolean().default(true),
    createdAt: z.string().optional(),
});

export const MarkingGuidancesSchema = z.array(MarkingGuidanceSchema);

export type MarkingGuidance = z.infer<typeof MarkingGuidanceSchema>;
export type MarkingGuidances = z.infer<typeof MarkingGuidancesSchema>;
```

- [ ] **Step 2: Replace the `UploadWorksheetActivityBodySchema` block (lines 594-599) with:**

```ts
export const UploadWorksheetActivityBodySchema = z
    .object({
        task: z.string().min(1),
        markingGuidance: z.string().optional().default(""),
        markingGuidanceId: z.string().optional(),
    })
    .passthrough()
    .refine(
        (body) => body.markingGuidance.trim().length > 0 || !!body.markingGuidanceId,
        { message: "Provide marking guidance text or select a marking guidance template.", path: ["markingGuidance"] },
    );
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors. (`UploadWorksheetActivityBody` type is now inferred from a `ZodEffects` wrapper — `z.infer` still resolves correctly through `.refine()`, but if any call site does `UploadWorksheetActivityBodySchema.shape...` it will break; grep for that before moving on.)

Run: `grep -rn "UploadWorksheetActivityBodySchema\.\(shape\|extend\)" src/`
Expected: no matches. If matches exist, note them and adjust those call sites to use `.innerType()` — do not change this task's schema shape to work around it.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add MarkingGuidance schema and markingGuidanceId field"
```

---

### Task 3: Marking guidance server actions

**Files:**
- Create: `src/lib/server-actions/marking-guidance.ts`
- Modify: `src/lib/server-updates.ts` (add re-export block)

**Interfaces:**
- Consumes: `MarkingGuidanceSchema`, `MarkingGuidancesSchema` from Task 2; `query` from `src/lib/db.ts`; `requireRole` from `src/lib/auth.ts`.
- Produces:
  - `readMarkingGuidancesAction(subject?: string): Promise<{ data: MarkingGuidance[] | null, error: string | null }>` — admin-only, returns all (active + inactive) rows, optionally filtered by subject, ordered by `subject ASC, title ASC`.
  - `readActiveMarkingGuidancesForSubjectAction(subject: string): Promise<{ data: MarkingGuidance[] | null, error: string | null }>` — no role guard beyond authenticated teacher (used by the lesson editor); returns only `active = true` rows for the given subject.
  - `createMarkingGuidanceAction(input: { subject: string; title: string; content: string }): Promise<{ data: null, error: string | null }>`
  - `updateMarkingGuidanceAction(input: { id: string; title: string; content: string }): Promise<{ data: null, error: string | null }>`
  - `setMarkingGuidanceActiveAction(id: string, active: boolean): Promise<{ data: null, error: string | null }>`

- [ ] **Step 1: Create the server actions file**

```ts
"use server"

import { z } from "zod"

import { MarkingGuidanceSchema } from "@/types"
import { requireRole, requireTeacherProfile } from "@/lib/auth"
import { query } from "@/lib/db"

const MarkingGuidancesResult = z.object({
  data: z.array(MarkingGuidanceSchema).nullable(),
  error: z.string().nullable(),
})

const MarkingGuidanceWriteResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

function toMarkingGuidance(row: Record<string, unknown>) {
  return MarkingGuidanceSchema.parse({
    id: row.id,
    subject: row.subject,
    title: row.title,
    content: row.content,
    active: row.active,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  })
}

export async function readMarkingGuidancesAction(
  subject?: string,
): Promise<z.infer<typeof MarkingGuidancesResult>> {
  try {
    await requireRole("admin")
    const { rows } = subject
      ? await query<Record<string, unknown>>(
          `SELECT id, subject, title, content, active, created_at FROM marking_guidances WHERE subject = $1 ORDER BY title ASC`,
          [subject],
        )
      : await query<Record<string, unknown>>(
          `SELECT id, subject, title, content, active, created_at FROM marking_guidances ORDER BY subject ASC, title ASC`,
        )
    return MarkingGuidancesResult.parse({ data: rows.map(toMarkingGuidance), error: null })
  } catch (e) {
    return MarkingGuidancesResult.parse({ data: null, error: String(e) })
  }
}

export async function readActiveMarkingGuidancesForSubjectAction(
  subject: string,
): Promise<z.infer<typeof MarkingGuidancesResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT id, subject, title, content, active, created_at FROM marking_guidances WHERE subject = $1 AND active = true ORDER BY title ASC`,
      [subject],
    )
    return MarkingGuidancesResult.parse({ data: rows.map(toMarkingGuidance), error: null })
  } catch (e) {
    return MarkingGuidancesResult.parse({ data: null, error: String(e) })
  }
}

export async function createMarkingGuidanceAction(input: {
  subject: string
  title: string
  content: string
}): Promise<z.infer<typeof MarkingGuidanceWriteResult>> {
  try {
    await requireRole("admin")
    const subject = input.subject.trim()
    const title = input.title.trim()
    const content = input.content.trim()
    if (!subject || !title || !content) {
      return MarkingGuidanceWriteResult.parse({ data: null, error: "Subject, title and content are required." })
    }
    await query(
      `INSERT INTO marking_guidances (subject, title, content, active) VALUES ($1, $2, $3, true)`,
      [subject, title, content],
    )
    return MarkingGuidanceWriteResult.parse({ data: null, error: null })
  } catch (e) {
    return MarkingGuidanceWriteResult.parse({ data: null, error: String(e) })
  }
}

export async function updateMarkingGuidanceAction(input: {
  id: string
  title: string
  content: string
}): Promise<z.infer<typeof MarkingGuidanceWriteResult>> {
  try {
    await requireRole("admin")
    const title = input.title.trim()
    const content = input.content.trim()
    if (!title || !content) {
      return MarkingGuidanceWriteResult.parse({ data: null, error: "Title and content are required." })
    }
    await query(`UPDATE marking_guidances SET title = $2, content = $3 WHERE id = $1`, [input.id, title, content])
    return MarkingGuidanceWriteResult.parse({ data: null, error: null })
  } catch (e) {
    return MarkingGuidanceWriteResult.parse({ data: null, error: String(e) })
  }
}

export async function setMarkingGuidanceActiveAction(
  id: string,
  active: boolean,
): Promise<z.infer<typeof MarkingGuidanceWriteResult>> {
  try {
    await requireRole("admin")
    await query(`UPDATE marking_guidances SET active = $2 WHERE id = $1`, [id, active])
    return MarkingGuidanceWriteResult.parse({ data: null, error: null })
  } catch (e) {
    return MarkingGuidanceWriteResult.parse({ data: null, error: String(e) })
  }
}
```

- [ ] **Step 2: Confirm `requireTeacherProfile` export signature matches usage**

Run: `grep -n "export async function requireTeacherProfile" src/lib/auth.ts`
Expected: a match with no required arguments (matches the call `await requireTeacherProfile()` used in `src/lib/server-actions/subjects.ts:23`). If the signature differs, adjust the call in Step 1 to match it exactly — do not change `auth.ts`.

- [ ] **Step 3: Add re-exports to `server-updates.ts`**

Add after the existing `subjects` re-export block (after line 111):

```ts
export {
  readMarkingGuidancesAction,
  readActiveMarkingGuidancesForSubjectAction,
  createMarkingGuidanceAction,
  updateMarkingGuidanceAction,
  setMarkingGuidanceActiveAction,
} from "./server-actions/marking-guidance";
```

- [ ] **Step 4: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors referencing `marking-guidance.ts` or `server-updates.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server-actions/marking-guidance.ts src/lib/server-updates.ts
git commit -m "feat: add marking guidance CRUD server actions"
```

---

### Task 4: Admin UI for Marking Guidance

**Files:**
- Create: `src/components/admin/MarkingGuidanceManager.tsx`
- Create: `src/app/admin/marking-guidance/page.tsx`
- Modify: admin nav — find and update the nav file that lists `/admin/subjects` (search `grep -rln "/admin/subjects" src/components src/app` to locate it) to add a `/admin/marking-guidance` link.

**Interfaces:**
- Consumes: `readAllSubjectsAction`, `readMarkingGuidancesAction`, `createMarkingGuidanceAction`, `updateMarkingGuidanceAction`, `setMarkingGuidanceActiveAction` from `@/lib/server-updates`; `MarkingGuidance`, `Subject` types from `@/types`; existing `RichTextEditor` component (locate its import path via `grep -rn "from .*RichTextEditor" src/components/lessons/lesson-activities-manager.tsx`); `Button` from `@/components/ui/button`.
- Produces: route `/admin/marking-guidance` rendering `MarkingGuidanceManager`.

- [ ] **Step 1: Locate the `RichTextEditor` import path used elsewhere**

Run: `grep -n "RichTextEditor" src/components/lessons/lesson-activities-manager.tsx | head -3`
Expected: an import line like `import { RichTextEditor } from "@/components/.../rich-text-editor"`. Use that exact path in the new component.

- [ ] **Step 2: Create `MarkingGuidanceManager.tsx`**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  createMarkingGuidanceAction,
  updateMarkingGuidanceAction,
  setMarkingGuidanceActiveAction,
} from '@/lib/server-updates'
import type { MarkingGuidance, Subject } from '@/types'
import { Button } from '@/components/ui/button'
// NOTE: replace this import with the exact path found in Task 4 Step 1
import { RichTextEditor } from '@/components/lessons/rich-text-editor'

type Props = {
  subjects: Subject[]
  initialGuidances: MarkingGuidance[]
}

function sortGuidances(guidances: MarkingGuidance[]): MarkingGuidance[] {
  return [...guidances].sort((a, b) => {
    const subjectCompare = a.subject.localeCompare(b.subject)
    if (subjectCompare !== 0) return subjectCompare
    return a.title.localeCompare(b.title)
  })
}

export function MarkingGuidanceManager({ subjects, initialGuidances }: Props) {
  const [guidances, setGuidances] = useState<MarkingGuidance[]>(sortGuidances(initialGuidances))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [subject, setSubject] = useState(subjects[0]?.subject ?? '')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const activeSubjects = useMemo(() => subjects.filter((s) => s.active), [subjects])

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setContent('')
  }

  function startEdit(guidance: MarkingGuidance) {
    setEditingId(guidance.id)
    setSubject(guidance.subject)
    setTitle(guidance.title)
    setContent(guidance.content)
  }

  async function handleSave() {
    const trimmedTitle = title.trim()
    const trimmedContent = content.trim()
    if (!trimmedTitle || !trimmedContent) {
      toast.error('Title and content are required')
      return
    }
    setSaving(true)
    if (editingId) {
      const { error } = await updateMarkingGuidanceAction({ id: editingId, title: trimmedTitle, content: trimmedContent })
      setSaving(false)
      if (error) {
        toast.error(error)
        return
      }
      setGuidances((prev) =>
        sortGuidances(prev.map((g) => (g.id === editingId ? { ...g, title: trimmedTitle, content: trimmedContent } : g))),
      )
      toast.success('Marking guidance updated')
      resetForm()
      return
    }

    if (!subject) {
      setSaving(false)
      toast.error('Select a subject')
      return
    }
    const { error } = await createMarkingGuidanceAction({ subject, title: trimmedTitle, content: trimmedContent })
    setSaving(false)
    if (error) {
      toast.error(error)
      return
    }
    setGuidances((prev) =>
      sortGuidances([
        ...prev,
        { id: crypto.randomUUID(), subject, title: trimmedTitle, content: trimmedContent, active: true },
      ]),
    )
    toast.success(`Added ${trimmedTitle}`)
    resetForm()
  }

  async function handleToggleActive(guidance: MarkingGuidance) {
    const { error } = await setMarkingGuidanceActiveAction(guidance.id, !guidance.active)
    if (error) {
      toast.error(error)
      return
    }
    setGuidances((prev) => prev.map((g) => (g.id === guidance.id ? { ...g, active: !guidance.active } : g)))
    toast.success(!guidance.active ? 'Guidance activated' : 'Guidance deactivated')
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-md border border-[var(--color-border)] p-4">
        <div className="flex items-center gap-2">
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={!!editingId}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
          >
            {activeSubjects.map((s) => (
              <option key={s.subject} value={s.subject}>
                {s.subject}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
          />
        </div>
        <RichTextEditor
          id="marking-guidance-content"
          value={content}
          onChange={setContent}
          placeholder="Markdown guidance content"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving || !title.trim() || !content.trim()}>
            {editingId ? 'Save changes' : 'Add guidance'}
          </Button>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-md border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
        {guidances.length === 0 && (
          <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">No marking guidances configured.</p>
        )}
        {guidances.map((g) => (
          <div key={g.id} className="flex items-center justify-between px-4 py-3 gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-xs rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-tertiary)]">
                {g.subject}
              </span>
              <span
                className={`text-sm font-medium ${g.active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] line-through'}`}
              >
                {g.title}
              </span>
              {!g.active && (
                <span className="text-xs rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-tertiary)]">
                  inactive
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => startEdit(g)}>
                Edit
              </Button>
              <Button size="sm" variant={g.active ? 'ghost' : 'outline'} onClick={() => handleToggleActive(g)}>
                {g.active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create the admin page**

```tsx
import { readAllSubjectsAction, readMarkingGuidancesAction } from '@/lib/server-updates'
import { MarkingGuidanceManager } from '@/components/admin/MarkingGuidanceManager'

export default async function MarkingGuidancePage() {
  const [{ data: subjects }, { data: guidances }] = await Promise.all([
    readAllSubjectsAction(),
    readMarkingGuidancesAction(),
  ])

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Marking Guidance</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Define reusable marking guidance templates per subject. Teachers can select one when configuring an Upload
          Worksheet activity.
        </p>
      </div>
      <MarkingGuidanceManager subjects={subjects ?? []} initialGuidances={guidances ?? []} />
    </div>
  )
}
```

- [ ] **Step 4: Add a nav link to the existing admin nav**

Run: `grep -rln "/admin/subjects" src/components src/app`
Open the matched file (excluding `src/app/admin/subjects/page.tsx` itself) and add a `/admin/marking-guidance` entry following the exact same markup/pattern as the existing `/admin/subjects` link.

- [ ] **Step 5: Manual verification**

Run: `pnpm dev`
Visit `/admin/marking-guidance` as an admin user. Add a guidance for a subject, edit it, deactivate it, reactivate it. Confirm toasts appear and the list updates without a full page reload.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/MarkingGuidanceManager.tsx src/app/admin/marking-guidance/page.tsx
git commit -m "feat: add admin UI for marking guidance templates"
```

(If Step 4 modified a nav file, add it to this commit too.)

---

### Task 5: Upload Worksheet editor — guidance dropdown

**Files:**
- Modify: `src/components/lessons/lesson-activities-manager.tsx`

**Interfaces:**
- Consumes: a new prop `availableMarkingGuidances: MarkingGuidance[]` on `LessonActivitiesManagerProps` (populated in Task 6).
- Produces: `uploadWorksheetBody.markingGuidanceId: string | undefined` flows into the saved `body_data`; `validateUploadWorksheetBody` now treats `markingGuidance` as optional when `markingGuidanceId` is set.

- [ ] **Step 1: Add the prop to `LessonActivitiesManagerProps` (near line 128-133)**

```ts
interface LessonActivitiesManagerProps {
  unitId: string
  lessonId: string
  initialActivities: LessonActivity[]
  availableSuccessCriteria: LessonActivitySuccessCriterionOption[]
  availableMarkingGuidances: MarkingGuidance[]
}
```

Add `MarkingGuidance` to the existing `@/types` import at the top of the file.

- [ ] **Step 2: Destructure the new prop where the component reads its props (find the line destructuring `availableSuccessCriteria` from props and add `availableMarkingGuidances` alongside it).**

- [ ] **Step 3: Update `createDefaultUploadWorksheetBody`, `getUploadWorksheetBody`, `normalizeUploadWorksheetBody` (lines 4823-4863)**

```ts
function createDefaultUploadWorksheetBody(): UploadWorksheetActivityBody {
  return {
    task: "",
    markingGuidance: "",
    markingGuidanceId: undefined,
  }
}

function getUploadWorksheetBody(activity: LessonActivity): UploadWorksheetActivityBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return createDefaultUploadWorksheetBody()
  }

  const record = activity.body_data as Record<string, unknown>
  const task = typeof record.task === "string" ? record.task : ""
  const markingGuidance =
    typeof record.markingGuidance === "string" ? record.markingGuidance : ""
  const markingGuidanceId =
    typeof record.markingGuidanceId === "string" ? record.markingGuidanceId : undefined

  return {
    ...(record as Record<string, unknown>),
    task,
    markingGuidance,
    markingGuidanceId,
  } as UploadWorksheetActivityBody
}

function normalizeUploadWorksheetBody(
  body: UploadWorksheetActivityBody | null | undefined,
): UploadWorksheetActivityBody {
  if (!body || typeof body !== "object") {
    return createDefaultUploadWorksheetBody()
  }

  const task = typeof body.task === "string" ? body.task.trim() : ""
  const markingGuidance =
    typeof body.markingGuidance === "string" ? body.markingGuidance.trim() : ""
  const markingGuidanceId =
    typeof body.markingGuidanceId === "string" && body.markingGuidanceId.length > 0
      ? body.markingGuidanceId
      : undefined

  return {
    ...(body as Record<string, unknown>),
    task,
    markingGuidance,
    markingGuidanceId,
  } as UploadWorksheetActivityBody
}
```

- [ ] **Step 4: Update `validateUploadWorksheetBody` (lines 4865-4878)**

```ts
function validateUploadWorksheetBody(body: UploadWorksheetActivityBody): string | null {
  const task = typeof body.task === "string" ? body.task.trim() : ""
  if (!task) {
    return "Add the task text before saving."
  }

  const markingGuidance =
    typeof body.markingGuidance === "string" ? body.markingGuidance.trim() : ""
  const hasGuidanceId = typeof body.markingGuidanceId === "string" && body.markingGuidanceId.length > 0
  if (!markingGuidance && !hasGuidanceId) {
    return "Add marking guidance text or select a marking guidance template."
  }

  return null
}
```

- [ ] **Step 5: Add a change handler next to `handleUploadWorksheetMarkingGuidanceChange` (lines 2253-2255)**

```ts
const handleUploadWorksheetGuidanceIdChange = useCallback((value: string) => {
  setUploadWorksheetBody((current) => ({
    ...current,
    markingGuidanceId: value === "" ? undefined : value,
  }))
}, [])
```

- [ ] **Step 6: Add the dropdown to the JSX, above the existing `RichTextEditor` block (before line 4309)**

```tsx
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground" htmlFor="upload-worksheet-marking-guidance-template">
                  Marking guidance template (optional)
                </Label>
                <select
                  id="upload-worksheet-marking-guidance-template"
                  value={uploadWorksheetBody.markingGuidanceId ?? ""}
                  onChange={(e) => handleUploadWorksheetGuidanceIdChange(e.target.value)}
                  disabled={isPending}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  {availableMarkingGuidances.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}{g.active ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
              </div>
```

Then update the existing `Label` text at line 4310-4312 from `"Marking guidance (required)"` to `"Additional marking guidance (optional if a template is selected)"`, and update the placeholder at line 4318 to `"Add any additional guidance the AI should follow"`.

- [ ] **Step 7: Ensure inactive-but-selected guidances still appear in the dropdown options**

`availableMarkingGuidances` (populated in Task 6) will only contain active guidances for the lesson's subject. If the currently edited activity has a `markingGuidanceId` that isn't in that list (because it was deactivated), the `<select>` would silently show no label for it. Add this just before the `<select>` in Step 6, computing a combined options list:

```ts
const selectedGuidanceId = uploadWorksheetBody.markingGuidanceId
const guidanceOptions = selectedGuidanceId && !availableMarkingGuidances.some((g) => g.id === selectedGuidanceId)
  ? [...availableMarkingGuidances, { id: selectedGuidanceId, title: "Previously selected guidance", subject: "", content: "", active: false }]
  : availableMarkingGuidances
```

Place this `const` declaration immediately above the `<select>` JSX from Step 6 (inside the same render scope as `uploadWorksheetBody`), and change the `.map()` in Step 6 to iterate `guidanceOptions` instead of `availableMarkingGuidances`.

- [ ] **Step 8: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors in `lesson-activities-manager.tsx`.

- [ ] **Step 9: Commit**

```bash
git add src/components/lessons/lesson-activities-manager.tsx
git commit -m "feat: add marking guidance template selector to upload worksheet editor"
```

---

### Task 6: Plumb subject and marking guidances through to the editor

**Files:**
- Modify: `src/app/lessons/[lessonId]/page.tsx`
- Modify: `src/components/lessons/lesson-detail-client.tsx`

**Interfaces:**
- Consumes: `readActiveMarkingGuidancesForSubjectAction` from `@/lib/server-updates` (Task 3); `lessonPayload.unit.subject` (existing `Unit` type, already has `subject: string`).
- Produces: `LessonDetailClient` receives a new prop `availableMarkingGuidances: MarkingGuidance[]` and forwards it to `LessonActivitiesManager` as `availableMarkingGuidances` (per Task 5's prop).

- [ ] **Step 1: Fetch guidances in `page.tsx`, after `learningObjectivesResult` is computed (around line 134) and before the error-check block**

```ts
  const lessonSubject = lessonPayload?.unit?.subject ?? null
  const markingGuidancesResult = lessonSubject
    ? await readActiveMarkingGuidancesForSubjectAction(lessonSubject)
    : { data: [], error: null }
```

Add `readActiveMarkingGuidancesForSubjectAction` to the existing `@/lib/server-updates` import at the top of the file.

- [ ] **Step 2: Pass the data into `LessonDetailClient` (in the JSX around line 183-194)**

```tsx
    <LessonDetailClient
      lesson={lesson}
      unit={lessonPayload?.unit ?? null}
      learningObjectives={curriculumLearningObjectives}
      curricula={referenceResult.data?.curricula ?? []}
      assessmentObjectives={referenceResult.data?.assessmentObjectives ?? []}
      lessonFiles={lessonPayload?.lessonFiles ?? []}
      lessonActivities={lessonPayload?.lessonActivities ?? []}
      unitLessons={lessonOptions}
      availableMarkingGuidances={markingGuidancesResult.data ?? []}
    />
```

- [ ] **Step 3: Add the prop to `LessonDetailClient`'s props type and pass it through to `LessonActivitiesManager`**

Find the props type/interface for `LessonDetailClient` (search `grep -n "interface.*Props\|type.*Props" src/components/lessons/lesson-detail-client.tsx` near the top of the file) and add:

```ts
  availableMarkingGuidances: MarkingGuidance[]
```

Add `MarkingGuidance` to that file's `@/types` import. Then update the destructured props and the `<LessonActivitiesManager>` JSX (around line 539-544):

```tsx
            <LessonActivitiesManager
              unitId={currentUnit?.unit_id ?? currentLesson.unit_id}
              lessonId={currentLesson.lesson_id}
              initialActivities={lessonActivitiesState}
              availableSuccessCriteria={lessonSuccessCriteria}
              availableMarkingGuidances={availableMarkingGuidances}
            />
```

- [ ] **Step 4: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors about missing/extra props on `LessonDetailClient` or `LessonActivitiesManager`.

- [ ] **Step 5: Manual verification**

Run: `pnpm dev`. Open a lesson belonging to a subject that has at least one active marking guidance (created in Task 4's manual check). Open an Upload Worksheet activity editor and confirm the dropdown lists that guidance.

- [ ] **Step 6: Commit**

```bash
git add src/app/lessons/[lessonId]/page.tsx src/components/lessons/lesson-detail-client.tsx
git commit -m "feat: pass subject-scoped marking guidances into lesson activity editor"
```

---

### Task 7: Resolve marking guidance in the AI marking queue

**Files:**
- Modify: `src/lib/ai/marking-queue.ts`

**Interfaces:**
- Consumes: `query` from `@/lib/db` (already imported in this file); `parsedActivity.markingGuidanceId` / `parsedActivity.markingGuidance` (from Task 2's schema).
- Produces: `marking_guidance` string passed to `invokeAiMarking` for upload-worksheet, now potentially prefixed with a resolved guidance's content.

- [ ] **Step 1: Add a helper function near the top of the file, after the imports (after line 12)**

```ts
async function resolveUploadWorksheetMarkingGuidance(
  markingGuidance: string,
  markingGuidanceId: string | undefined,
): Promise<string> {
  if (!markingGuidanceId) {
    return markingGuidance;
  }

  const { rows } = await query<{ content: string }>(
    `SELECT content FROM marking_guidances WHERE id = $1`,
    [markingGuidanceId],
  );

  const guidanceContent = rows[0]?.content;
  if (!guidanceContent) {
    return markingGuidance;
  }

  return [guidanceContent, markingGuidance].filter((part) => part.trim().length > 0).join("\n\n");
}
```

- [ ] **Step 2: Use the helper in the upload-worksheet branch — replace line 318 (`marking_guidance: parsedActivity.markingGuidance,`) inside the `doParams` object**

Before the `doParams` object is built (i.e. before line 316 `const doParams = {`), add:

```ts
      const resolvedMarkingGuidance = await resolveUploadWorksheetMarkingGuidance(
        parsedActivity.markingGuidance,
        parsedActivity.markingGuidanceId,
      );
```

Then change the `doParams` object's `marking_guidance` field to:

```ts
        marking_guidance: resolvedMarkingGuidance,
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors in `marking-queue.ts`.

- [ ] **Step 4: Manual verification**

With the dev server running and `N8N_MARKING_WEBHOOK_URL` configured (or temporarily logging `resolvedMarkingGuidance` before the `invokeAiMarking` call for local inspection), create an Upload Worksheet activity with a selected guidance and minimal/no free text, submit a worksheet for it, and confirm in logs (`logQueueEvent` output or a temporary `console.log`) that the resolved text contains the guidance content followed by the free text. Remove any temporary debug logging before committing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/marking-queue.ts
git commit -m "feat: resolve marking guidance template before AI marking submission"
```

---

### Task 8: End-to-end verification and lint

**Files:** none (verification only)

- [ ] **Step 1: Full lint pass**

Run: `pnpm lint`
Expected: no new errors introduced by this feature (pre-existing unrelated warnings are fine).

- [ ] **Step 2: Full type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual end-to-end walkthrough**

1. As admin: visit `/admin/marking-guidance`, create a guidance "Show working" for subject "Maths" with markdown content.
2. As teacher: open a Maths lesson, add/edit an Upload Worksheet activity, select "Show working" in the new dropdown, leave the free-text marking guidance empty, save. Confirm save succeeds (no "Marking guidance is required" error).
3. Reopen the activity editor — confirm the dropdown still shows "Show working" selected.
4. As admin: deactivate "Show working". Reopen the same activity editor — confirm the dropdown still shows it (labeled "(inactive)") because it's the activity's current selection, but confirm it no longer appears as a selectable option on a *different*, unrelated Upload Worksheet activity's dropdown for the same subject.
5. Submit a worksheet against the activity from step 2 as a pupil, and confirm (via logs or temporary inspection) that the AI marking payload's `marking_guidance` includes the deactivated guidance's content.

- [ ] **Step 4: Report results**

Summarize pass/fail for each of the 5 manual checks above before considering the feature complete.
