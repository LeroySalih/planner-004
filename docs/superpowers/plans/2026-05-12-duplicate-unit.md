# Duplicate Unit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow teachers to duplicate a unit from the `/units` list and `/units/[unitId]` detail pages, producing a full isolated copy (unit + lessons + activities + files) with LOs and SCs shared by reference, then redirect to the new unit.

**Architecture:** A single synchronous server action (`duplicateUnitAction`) loads all source data, runs one PostgreSQL transaction to insert the full copy, then copies lesson files on disk. A shared `DuplicateUnitTrigger` client component handles the button, loading state, and post-success redirect via `router.push`. Version naming is a pure utility function that parses and increments the `.vN` suffix in the unit title.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, PostgreSQL (`pg`), `node:fs/promises` for file copying, `sonner` for toasts, `next/navigation` `useRouter` for redirect.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/unit-version.ts` | Create | Pure `incrementUnitTitle()` utility |
| `src/lib/server-actions/units.ts` | Modify | Add `duplicateUnitAction` |
| `src/lib/server-updates.ts` | Modify | Re-export `duplicateUnitAction` |
| `src/components/units/duplicate-unit-trigger.tsx` | Create | Client button component |
| `src/app/units/page.tsx` | Modify | Add trigger to `UnitCard` |
| `src/components/units/unit-detail-view.tsx` | Modify | Add trigger to unit header |

---

## Task 1: Version naming utility

**Files:**
- Create: `src/lib/unit-version.ts`

- [ ] **Step 1: Create the utility file**

```typescript
// src/lib/unit-version.ts

const VERSION_SUFFIX_RE = /^(.*?)\.v(\d+)$/

export function incrementUnitTitle(title: string): string {
  const match = VERSION_SUFFIX_RE.exec(title.trimEnd())
  if (match) {
    const base = match[1]
    const n = parseInt(match[2], 10)
    return `${base}.v${n + 1}`
  }
  return `${title.trimEnd()}.v1`
}
```

- [ ] **Step 2: Verify with a quick sanity check in the terminal**

```bash
cd /path/to/worktree
node -e "
const { incrementUnitTitle } = require('./src/lib/unit-version.ts')
" 2>&1 || node --input-type=module <<'EOF'
// Can't require TS directly — verify via type-check instead
EOF
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/unit-version.ts
git commit -m "feat(unit-version): add incrementUnitTitle utility"
```

---

## Task 2: `duplicateUnitAction` server action

**Files:**
- Modify: `src/lib/server-actions/units.ts`

This action:
1. Authenticates the teacher
2. Loads all source data in parallel
3. Runs a single DB transaction inserting unit → lessons → LO refs → SC refs → links → activities → activity SC refs
4. Copies lesson files on disk
5. Revalidates `/units` and returns `{ newUnitId, fileWarnings }`

- [ ] **Step 1: Add imports at the top of `src/lib/server-actions/units.ts`**

The file already imports `randomUUID`, `withDbClient`, `query`, `revalidatePath`, and `z`. Add the file system import after the existing node imports:

```typescript
import { promises as fs } from "node:fs"
import path from "node:path"
```

Also add the `incrementUnitTitle` import after the existing local imports:

```typescript
import { incrementUnitTitle } from "@/lib/unit-version"
```

- [ ] **Step 2: Add the return schema at the bottom of the schema block (after the existing `UnitDeactivateFormSchema`)**

```typescript
const DuplicateUnitReturnValue = z.object({
  data: z
    .object({
      newUnitId: z.string(),
      fileWarnings: z.array(z.string()),
    })
    .nullable(),
  error: z.string().nullable(),
})
```

- [ ] **Step 3: Add the `duplicateUnitAction` function at the end of the file**

```typescript
export async function duplicateUnitAction(unitId: string) {
  await requireTeacherProfile()

  // ── 1. Load source data ──────────────────────────────────────────────────
  const { rows: unitRows } = await query<{
    unit_id: string
    title: string
    subject: string
    description: string | null
    year: number | null
    active: boolean
  }>(
    `select unit_id, title, subject, description, year, active
     from units where unit_id = $1 limit 1`,
    [unitId],
  )

  const sourceUnit = unitRows[0] ?? null
  if (!sourceUnit) {
    return DuplicateUnitReturnValue.parse({ data: null, error: "Unit not found." })
  }

  const { rows: lessons } = await query<{
    lesson_id: string
    title: string
    order_by: number
    active: boolean
  }>(
    `select lesson_id, title, order_by, active
     from lessons where unit_id = $1`,
    [unitId],
  )

  const oldLessonIds = lessons.map((l) => l.lesson_id)

  const [loRows, scRows, linkRows, activityRows] = await Promise.all([
    oldLessonIds.length > 0
      ? query<{
          lesson_id: string
          learning_objective_id: string
          title: string
          order_index: number
          order_by: number
          active: boolean
        }>(
          `select lesson_id, learning_objective_id, title, order_index, order_by, active
           from lessons_learning_objective
           where lesson_id = any($1::text[])`,
          [oldLessonIds],
        )
      : Promise.resolve({ rows: [] }),
    oldLessonIds.length > 0
      ? query<{ lesson_id: string; success_criteria_id: string }>(
          `select lesson_id, success_criteria_id
           from lesson_success_criteria
           where lesson_id = any($1::text[])`,
          [oldLessonIds],
        )
      : Promise.resolve({ rows: [] }),
    oldLessonIds.length > 0
      ? query<{ lesson_id: string; url: string; description: string | null }>(
          `select lesson_id, url, description
           from lesson_links
           where lesson_id = any($1::text[])`,
          [oldLessonIds],
        )
      : Promise.resolve({ rows: [] }),
    oldLessonIds.length > 0
      ? query<{
          activity_id: string
          lesson_id: string
          title: string | null
          type: string | null
          body_data: unknown
          order_by: number | null
          active: boolean
          is_summative: boolean
          notes: string | null
        }>(
          `select activity_id, lesson_id, title, type, body_data, order_by, active, is_summative, notes
           from activities
           where lesson_id = any($1::text[])`,
          [oldLessonIds],
        )
      : Promise.resolve({ rows: [] }),
  ])

  const oldActivityIds = activityRows.rows.map((a) => a.activity_id)

  const { rows: actScRows } = oldActivityIds.length > 0
    ? await query<{ activity_id: string; success_criteria_id: string }>(
        `select activity_id, success_criteria_id
         from activity_success_criteria
         where activity_id = any($1::text[])`,
        [oldActivityIds],
      )
    : { rows: [] }

  // ── 2. DB transaction ────────────────────────────────────────────────────
  const newUnitId = randomUUID()
  const newTitle = incrementUnitTitle(sourceUnit.title)

  // Maps used to repoint foreign keys
  const lessonIdMap = new Map<string, string>() // old → new
  const activityIdMap = new Map<string, string>() // old → new

  try {
    await withDbClient(async (client) => {
      await client.query("begin")

      // Insert unit
      await client.query(
        `insert into units (unit_id, title, subject, description, year, active)
         values ($1, $2, $3, $4, $5, true)`,
        [newUnitId, newTitle, sourceUnit.subject, sourceUnit.description, sourceUnit.year],
      )

      // Insert lessons
      for (const lesson of lessons) {
        const newLessonId = randomUUID()
        lessonIdMap.set(lesson.lesson_id, newLessonId)
        await client.query(
          `insert into lessons (lesson_id, unit_id, title, order_by, active)
           values ($1, $2, $3, $4, $5)`,
          [newLessonId, newUnitId, lesson.title, lesson.order_by, lesson.active],
        )
      }

      // Insert lessons_learning_objective
      for (const lo of loRows.rows) {
        const newLessonId = lessonIdMap.get(lo.lesson_id)
        if (!newLessonId) continue
        await client.query(
          `insert into lessons_learning_objective
             (lesson_id, learning_objective_id, title, order_index, order_by, active)
           values ($1, $2, $3, $4, $5, $6)`,
          [newLessonId, lo.learning_objective_id, lo.title, lo.order_index, lo.order_by, lo.active],
        )
      }

      // Insert lesson_success_criteria
      for (const sc of scRows.rows) {
        const newLessonId = lessonIdMap.get(sc.lesson_id)
        if (!newLessonId) continue
        await client.query(
          `insert into lesson_success_criteria (lesson_id, success_criteria_id)
           values ($1, $2)`,
          [newLessonId, sc.success_criteria_id],
        )
      }

      // Insert lesson_links
      for (const link of linkRows.rows) {
        const newLessonId = lessonIdMap.get(link.lesson_id)
        if (!newLessonId) continue
        await client.query(
          `insert into lesson_links (lesson_link_id, lesson_id, url, description)
           values ($1, $2, $3, $4)`,
          [randomUUID(), newLessonId, link.url, link.description],
        )
      }

      // Insert activities
      for (const act of activityRows.rows) {
        const newActivityId = randomUUID()
        const newLessonId = lessonIdMap.get(act.lesson_id)
        if (!newLessonId) continue
        activityIdMap.set(act.activity_id, newActivityId)
        await client.query(
          `insert into activities
             (activity_id, lesson_id, title, type, body_data, order_by, active, is_summative, notes)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            newActivityId,
            newLessonId,
            act.title,
            act.type,
            act.body_data ?? null,
            act.order_by,
            act.active,
            act.is_summative,
            act.notes,
          ],
        )
      }

      // Insert activity_success_criteria
      for (const asc of actScRows) {
        const newActivityId = activityIdMap.get(asc.activity_id)
        if (!newActivityId) continue
        await client.query(
          `insert into activity_success_criteria (activity_id, success_criteria_id)
           values ($1, $2)`,
          [newActivityId, asc.success_criteria_id],
        )
      }

      await client.query("commit")
    })
  } catch (error) {
    console.error("[units] duplicateUnitAction transaction failed", { unitId, error })
    const message = error instanceof Error ? error.message : "Failed to duplicate unit."
    return DuplicateUnitReturnValue.parse({ data: null, error: message })
  }

  // ── 3. Copy lesson files ─────────────────────────────────────────────────
  const fileWarnings: string[] = []
  const BASE_DIR = path.join(process.cwd(), "files")

  for (const [oldLessonId, newLessonId] of lessonIdMap) {
    try {
      const { rows: fileRows } = await query<{
        file_name: string
        stored_path: string
        size_bytes: number | null
        content_type: string | null
        checksum: string | null
      }>(
        `select file_name, stored_path, size_bytes, content_type, checksum
         from stored_files
         where bucket = 'lessons' and scope_path = $1`,
        [oldLessonId],
      )

      for (const file of fileRows) {
        const newStoredPath = `lessons/${newLessonId}/${file.file_name}`
        const srcDisk = path.join(BASE_DIR, file.stored_path)
        const dstDisk = path.join(BASE_DIR, newStoredPath)

        try {
          await fs.mkdir(path.dirname(dstDisk), { recursive: true })
          await fs.copyFile(srcDisk, dstDisk)
          await query(
            `insert into stored_files
               (bucket, scope_path, file_name, stored_path, size_bytes, content_type, checksum, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, timezone('utc', now()), timezone('utc', now()))
             on conflict (bucket, scope_path, file_name) do nothing`,
            [
              "lessons",
              newLessonId,
              file.file_name,
              newStoredPath,
              file.size_bytes,
              file.content_type,
              file.checksum,
            ],
          )
        } catch (fileError) {
          console.error("[units] file copy failed", { oldLessonId, newLessonId, file: file.file_name, fileError })
          fileWarnings.push(`Lesson ${newLessonId}: failed to copy ${file.file_name}`)
        }
      }
    } catch (queryError) {
      console.error("[units] failed to query files for lesson", { oldLessonId, queryError })
      fileWarnings.push(`Lesson ${oldLessonId}: failed to read source files`)
    }
  }

  revalidatePath("/units")

  return DuplicateUnitReturnValue.parse({
    data: { newUnitId, fileWarnings },
    error: null,
  })
}
```

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to the new function.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server-actions/units.ts src/lib/unit-version.ts
git commit -m "feat(units): add duplicateUnitAction server action"
```

---

## Task 3: Export from server-updates

**Files:**
- Modify: `src/lib/server-updates.ts`

- [ ] **Step 1: Add the export to the units block in `src/lib/server-updates.ts`**

Find the existing units export block (around line 30):

```typescript
} from "./server-actions/units";
```

Change it to also export `duplicateUnitAction`:

```typescript
  duplicateUnitAction,
} from "./server-actions/units";
```

The full block should look like:

```typescript
export {
  createUnitAction,
  readUnitAction,
  readUnitsAction,
  updateUnitAction,
  deleteUnitAction,
  triggerUnitUpdateJobAction,
  triggerUnitDeactivateJobAction,
  duplicateUnitAction,
} from "./server-actions/units"
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-updates.ts
git commit -m "feat(server-updates): export duplicateUnitAction"
```

---

## Task 4: `DuplicateUnitTrigger` client component

**Files:**
- Create: `src/components/units/duplicate-unit-trigger.tsx`

This is a `"use client"` component. It calls `duplicateUnitAction`, shows a spinner during the call, then either redirects to the new unit or shows a toast.

- [ ] **Step 1: Create the component**

```typescript
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { duplicateUnitAction } from "@/lib/server-updates"

interface DuplicateUnitTriggerProps {
  unitId: string
  unitTitle: string
  variant?: "default" | "outline" | "ghost" | "secondary"
  size?: "default" | "sm" | "lg" | "icon"
}

export function DuplicateUnitTrigger({
  unitId,
  unitTitle,
  variant = "outline",
  size = "default",
}: DuplicateUnitTriggerProps) {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)

  async function handleDuplicate() {
    setIsPending(true)
    try {
      const result = await duplicateUnitAction(unitId)

      if (result.error || !result.data) {
        toast.error(result.error ?? "Failed to duplicate unit.")
        return
      }

      const { newUnitId, fileWarnings } = result.data

      if (fileWarnings.length > 0) {
        toast.warning(`Unit duplicated, but some files could not be copied:\n${fileWarnings.join("\n")}`)
      }

      router.push(`/units/${encodeURIComponent(newUnitId)}`)
    } catch {
      toast.error("An unexpected error occurred while duplicating the unit.")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleDuplicate}
      disabled={isPending}
      aria-label={`Duplicate ${unitTitle}`}
    >
      <Copy className="mr-2 h-4 w-4" />
      {isPending ? "Duplicating…" : "Duplicate"}
    </Button>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/units/duplicate-unit-trigger.tsx
git commit -m "feat(units): add DuplicateUnitTrigger client component"
```

---

## Task 5: Add Duplicate button to `/units` list page

**Files:**
- Modify: `src/app/units/page.tsx`

The `UnitCard` component is defined in this file. Add the `DuplicateUnitTrigger` below the "View unit →" link.

- [ ] **Step 1: Import `DuplicateUnitTrigger` in `src/app/units/page.tsx`**

Add to the import block at the top:

```typescript
import { DuplicateUnitTrigger } from "@/components/units/duplicate-unit-trigger"
```

- [ ] **Step 2: Add the trigger inside `UnitCard`**

Find the `UnitCard` return — specifically the line:

```tsx
        <Link href={`/units/${unit.unit_id}`} className="text-sm font-medium text-primary hover:underline">
          View unit →
        </Link>
```

Replace it with:

```tsx
        <div className="flex items-center justify-between">
          <Link href={`/units/${unit.unit_id}`} className="text-sm font-medium text-primary hover:underline">
            View unit →
          </Link>
          <DuplicateUnitTrigger unitId={unit.unit_id} unitTitle={unit.title} variant="ghost" size="sm" />
        </div>
```

- [ ] **Step 3: Type-check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Start dev server and verify visually**

```bash
pnpm dev
```

Open `http://localhost:3000/units`. Confirm each unit card shows a "Duplicate" button. Click one — confirm spinner, then redirect to the new unit's page with the versioned title.

- [ ] **Step 5: Commit**

```bash
git add src/app/units/page.tsx
git commit -m "feat(units): add Duplicate button to UnitCard on /units list"
```

---

## Task 6: Add Duplicate button to `/units/[unitId]` detail page

**Files:**
- Modify: `src/components/units/unit-detail-view.tsx`

The unit header has a `<div className="flex gap-2 self-start">` containing the report download buttons and the Edit Unit button. Add `DuplicateUnitTrigger` to this group.

- [ ] **Step 1: Import `DuplicateUnitTrigger` in `unit-detail-view.tsx`**

Add to the import block:

```typescript
import { DuplicateUnitTrigger } from "@/components/units/duplicate-unit-trigger"
```

- [ ] **Step 2: Add the trigger to the button group in the unit header**

Find this block (around line 312):

```tsx
          <div className="flex gap-2 self-start">
            <UnitReportDownloadButton unitId={currentUnit.unit_id} />
            <UnitReportDocxDownloadButton unitId={currentUnit.unit_id} />
            <Button onClick={() => setIsUnitSidebarOpen(true)}>
              <Edit2 className="mr-2 h-4 w-4" />
              Edit Unit
            </Button>
          </div>
```

Replace with:

```tsx
          <div className="flex gap-2 self-start">
            <UnitReportDownloadButton unitId={currentUnit.unit_id} />
            <UnitReportDocxDownloadButton unitId={currentUnit.unit_id} />
            <DuplicateUnitTrigger unitId={currentUnit.unit_id} unitTitle={currentUnit.title} variant="outline" />
            <Button onClick={() => setIsUnitSidebarOpen(true)}>
              <Edit2 className="mr-2 h-4 w-4" />
              Edit Unit
            </Button>
          </div>
```

- [ ] **Step 3: Type-check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Verify visually**

Open `http://localhost:3000/units/<any-unit-id>`. Confirm the "Duplicate" button appears in the header. Click — confirm spinner, then redirect to new versioned unit.

- [ ] **Step 5: Commit**

```bash
git add src/components/units/unit-detail-view.tsx
git commit -m "feat(units): add Duplicate button to unit detail page header"
```

---

## Task 7: Final integration smoke test

- [ ] **Step 1: Test version naming edge cases manually**

In the browser, duplicate a unit named `"Systems 1"` — confirm new unit title is `"Systems 1.v1"`.  
Duplicate `"Systems 1.v1"` — confirm `"Systems 1.v2"`.  
Duplicate a unit with no suffix — confirm `.v1` is appended.

- [ ] **Step 2: Verify lessons are duplicated**

On the new unit's page, confirm all lessons appear with the same titles and order.

- [ ] **Step 3: Verify activities are duplicated**

Navigate to a lesson in the new unit — confirm activities are present with the same content.

- [ ] **Step 4: Verify LOs and SCs are shared references (not copies)**

Confirm `learning_objective_id` values in the new unit's lessons match the originals. Check via:

```bash
psql $DATABASE_URL -c "
  SELECT l.lesson_id, llo.learning_objective_id
  FROM lessons l
  JOIN lessons_learning_objective llo ON llo.lesson_id = l.lesson_id
  WHERE l.unit_id = '<new_unit_id>'
  LIMIT 10;
"
```

The `learning_objective_id` values should be the same as the original unit's lessons.

- [ ] **Step 5: Verify file copy**

Upload a file to a lesson in the source unit. Duplicate the unit. Navigate to the equivalent lesson in the new unit and confirm the file appears.

- [ ] **Step 6: Final commit (if any fixups needed)**

```bash
git add -p
git commit -m "fix(units): post-integration fixups for unit duplication"
```
