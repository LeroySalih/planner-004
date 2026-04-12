# Class Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ClassFilter` dropdown on `/assignments` with a combobox that shows selected groups as removable chips and a text input that filters a dropdown list.

**Architecture:** Rewrite `class-filter.tsx` in-place with the new `ClassCombobox` component (same export name `ClassFilter` so `page.tsx` import is unchanged). Update `page.tsx` to load all active classes when no `?classes=` query param is present, removing the DEFAULT_CLASSES fallback and the empty-state guard.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS v4, Radix UI, Lucide icons, `useRouter`/`usePathname` from `next/navigation`.

---

### Task 1: Rewrite ClassFilter as a combobox with chips

**Files:**
- Modify: `src/components/assignment-manager/class-filter.tsx`

The new component keeps the same props interface. Behaviour:
- Chips row: each selected group renders as a badge with a `×` button
- Text input below chips: placeholder "Filter classes…", typing narrows the dropdown
- Dropdown: rendered as an absolutely-positioned list, visible when the input is focused or non-empty. Shows all groups when input is empty, partial case-insensitive matches on `group_id` and `subject` when non-empty.
- Clicking a group in the dropdown: adds chip, clears input, keeps dropdown open
- Clicking `×` on a chip: removes that group from selection
- Every selection change calls `navigate()` which updates `?classes=ID1,ID2` in the URL (or removes the param if no groups selected), then calls `router.replace` + `router.refresh()`
- Clicking outside the dropdown closes it (via `onBlur` with a short timeout to allow click events to fire first)

- [ ] **Step 1: Replace the file contents**

Replace `src/components/assignment-manager/class-filter.tsx` with:

```tsx
"use client"

import { useRouter, usePathname } from "next/navigation"
import { useCallback, useState, useRef, useTransition } from "react"
import { X, Loader2 } from "lucide-react"

interface ClassFilterProps {
  allGroups: { group_id: string; subject: string }[]
  selectedGroupIds: string[]
}

export function ClassFilter({ allGroups, selectedGroupIds: initialSelectedGroupIds }: ClassFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [selectedGroupIds, setSelectedGroupIds] = useState(initialSelectedGroupIds)
  const [inputValue, setInputValue] = useState("")
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const navigate = useCallback(
    (groupIds: string[]) => {
      setSelectedGroupIds(groupIds)
      startTransition(() => {
        const params = new URLSearchParams()
        if (groupIds.length > 0) {
          params.set("classes", groupIds.join(","))
        }
        const url = params.toString() ? `${pathname}?${params.toString()}` : pathname
        router.replace(url)
        router.refresh()
      })
    },
    [router, pathname],
  )

  const addGroup = (groupId: string) => {
    if (!selectedGroupIds.includes(groupId)) {
      navigate([...selectedGroupIds, groupId])
    }
    setInputValue("")
  }

  const removeGroup = (groupId: string) => {
    navigate(selectedGroupIds.filter((id) => id !== groupId))
  }

  const filteredGroups = allGroups.filter((g) => {
    if (selectedGroupIds.includes(g.group_id)) return false
    if (!inputValue) return true
    const term = inputValue.toLowerCase()
    return g.group_id.toLowerCase().includes(term) || g.subject.toLowerCase().includes(term)
  })

  const handleBlur = () => {
    closeTimerRef.current = setTimeout(() => setDropdownOpen(false), 150)
  }

  const handleDropdownMouseDown = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }

  return (
    <div className="flex items-start gap-2">
      <div className="relative w-[320px]">
        {/* Chips */}
        {selectedGroupIds.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {selectedGroupIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-md bg-secondary text-secondary-foreground text-xs px-2 py-1"
              >
                {id}
                <button
                  type="button"
                  onClick={() => removeGroup(id)}
                  className="hover:text-destructive focus:outline-none"
                  aria-label={`Remove ${id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Input */}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            setDropdownOpen(true)
          }}
          onFocus={() => setDropdownOpen(true)}
          onBlur={handleBlur}
          placeholder="Filter classes…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        />

        {/* Dropdown */}
        {dropdownOpen && filteredGroups.length > 0 && (
          <div
            onMouseDown={handleDropdownMouseDown}
            className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-[260px] overflow-y-auto"
          >
            {filteredGroups.map((group) => (
              <button
                key={group.group_id}
                type="button"
                onClick={() => addGroup(group.group_id)}
                className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
              >
                <span>{group.group_id}</span>
                <span className="text-muted-foreground text-xs">{group.subject}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mt-2.5" />}
    </div>
  )
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors related to `class-filter.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/assignment-manager/class-filter.tsx
git commit -m "feat: replace ClassFilter dropdown with combobox and chips"
```

---

### Task 2: Load all active classes when no ?classes= param

**Files:**
- Modify: `src/app/assignments/page.tsx`

Currently when no `?classes=` param is present, the page falls back to `DEFAULT_CLASSES = ["25-11-DT"]` and shows a "Select one or more classes" empty state when `resolvedGroupIds` is empty.

New behaviour: no `?classes=` param → use all active group IDs → always show the full assignment manager. Remove `DEFAULT_CLASSES` and the empty-state guard block.

- [ ] **Step 1: Update page.tsx**

In `src/app/assignments/page.tsx`, apply these changes:

1. Remove the `DEFAULT_CLASSES` constant (line 12).
2. When `classesParam` is absent, use all group IDs from `allGroups` instead:

```ts
// Replace lines 31-33:
const selectedGroupIds = classesParam
  ? classesParam.split(",").map((c) => c.trim()).filter(Boolean)
  : allGroups.map((g) => g.group_id)
```

3. Remove the early-return empty-state block (lines 41-58) that renders "Select one or more classes to view assignments." — it is no longer reachable because an empty `resolvedGroupIds` can only occur if the URL contains invalid group IDs, not from a missing param.

4. Update the comment on line 21 from "for the class filter dropdown" to "for the class combobox".

The top of the file after changes should look like:

```ts
export const dynamic = "force-dynamic"

import AssignmentManager from "@/components/assignment-manager"
import { ClassFilter } from "@/components/assignment-manager/class-filter"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { BookOpen } from "lucide-react"
import { readAssignmentsBootstrapForGroupsAction, readLessonAssignmentScoreSummariesAction, listDateCommentsAction, readGroupsAction } from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"
import type { Assignments, AssignmentsBootstrapPayload, DateComments, Groups, LessonAssignments, Lessons, Subjects, Units } from "@/types"

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ classes?: string }>
}) {
  const teacherProfile = await requireTeacherProfile()

  // Load all active groups for the class combobox
  const { data: allGroupsData } = await readGroupsAction({ currentProfile: teacherProfile })
  const allGroups = (allGroupsData ?? []).map((g) => ({
    group_id: g.group_id,
    subject: g.subject,
  }))

  // Determine selected classes from query params; default to all active groups
  const params = await searchParams
  const classesParam = params.classes
  const selectedGroupIds = classesParam
    ? classesParam.split(",").map((c) => c.trim()).filter(Boolean)
    : allGroups.map((g) => g.group_id)

  // Resolve group IDs case-insensitively against known groups
  const groupIdMap = new Map(allGroups.map((g) => [g.group_id.toLowerCase(), g.group_id]))
  const resolvedGroupIds = selectedGroupIds
    .map((id) => groupIdMap.get(id.toLowerCase()))
    .filter((id): id is string => id != null)

  const { data: bootstrapData, error: bootstrapError } = await readAssignmentsBootstrapForGroupsAction(resolvedGroupIds)
  // ... rest unchanged
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/assignments/page.tsx
git commit -m "feat: load all active classes by default when no ?classes= param"
```

---

### Task 3: Manual smoke test

- [ ] **Step 1: Start the dev server (if not already running)**

```bash
cd /Users/leroysalih/nodejs/planner-004 && pnpm dev
```

- [ ] **Step 2: Open the page with no query param**

Navigate to `http://localhost:3000/assignments`

Expected: all active classes load, assignment manager shows data for all groups, combobox shows no chips and empty input.

- [ ] **Step 3: Filter and select a class**

Type "DT" in the filter input.

Expected: dropdown shows only groups whose `group_id` or `subject` contains "DT".

Click one of the results (e.g., `25-8B-DT`).

Expected: chip `[25-8B-DT ×]` appears above the input, URL updates to `?classes=25-8B-DT`, assignment manager reloads showing only that class.

- [ ] **Step 4: Select a second class**

Type "9C" in the filter input, click `25-9C-DT`.

Expected: two chips visible, URL is `?classes=25-8B-DT,25-9C-DT`, manager shows both classes.

- [ ] **Step 5: Remove a chip**

Click `×` on `25-8B-DT`.

Expected: one chip remains, URL updates to `?classes=25-9C-DT`.

- [ ] **Step 6: Remove last chip**

Click `×` on the remaining chip.

Expected: no chips, no `?classes=` param, all classes load again.

- [ ] **Step 7: Test query string pre-population**

Navigate directly to `http://localhost:3000/assignments?classes=25-8B-DT,25-9C-DT`

Expected: two chips pre-populated, manager shows those two classes.

- [ ] **Step 8: Push to remote**

```bash
git push
```
