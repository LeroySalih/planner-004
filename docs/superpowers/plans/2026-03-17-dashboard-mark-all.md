# Dashboard Mark All Button Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Mark All" button to each lesson card in the Needs Review panel that queues all unscored short-text submissions for that lesson+group for AI marking.

**Architecture:** A new server action `markAllUnmarkedForLessonAction` queries unscored submissions for a given `groupId`+`lessonId`, enqueues them for AI marking, then returns a count. A `MarkAllButton` client component calls this action and calls `router.refresh()` on success. `MarkingQueuePanel` (server component) renders a `MarkAllButton` per card.

**Tech Stack:** Next.js 15 App Router, TypeScript, PostgreSQL via `pg`, `sonner` toasts, `useTransition`, Tailwind CSS v4

---

## File Map

| File | Change |
|------|--------|
| `src/lib/server-actions/dashboard.ts` | Add `markAllUnmarkedForLessonAction` |
| `src/lib/server-updates.ts` | Re-export new action |
| `src/components/teacher-dashboard/mark-all-button.tsx` | Create client component |
| `src/components/teacher-dashboard/marking-queue-panel.tsx` | Add `MarkAllButton` to each card |

---

## Task 1: Server action — `markAllUnmarkedForLessonAction`

**Files:**
- Modify: `src/lib/server-actions/dashboard.ts`
- Modify: `src/lib/server-updates.ts`

### Context

`dashboard.ts` already imports `requireTeacherProfile`, `withTelemetry`, `query`, and `performance`. The file starts with `"use server"`.

The action must:
- Call `enqueueMarkingTasks` and `triggerQueueProcessor` from `@/lib/ai/marking-queue` directly (NOT `triggerBulkAiMarkingAction` — that function has no auth guard)
- Use `assignmentId = groupId + "__" + lessonId` (the separator `__` matches the codebase convention in `assignment-results.ts`)
- NOT call `revalidatePath` — client-side `router.refresh()` handles invalidation

### Steps

- [ ] **Step 1: Add the import for `enqueueMarkingTasks` and `triggerQueueProcessor` at the top of `dashboard.ts`**

Add after the existing imports:

```typescript
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
```

- [ ] **Step 2: Add the Zod input schema and the action at the bottom of `dashboard.ts`**

Append to end of file:

```typescript
// ── Mark All Unmarked ─────────────────────────────────────────────────────────

const MarkAllUnmarkedInputSchema = z.object({
  groupId: z.string().min(1),
  lessonId: z.string().min(1),
})

const MarkAllUnmarkedResultSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  error: z.string().nullable(),
})

export async function markAllUnmarkedForLessonAction(input: z.infer<typeof MarkAllUnmarkedInputSchema>) {
  await requireTeacherProfile()
  const authEndTime = performance.now()

  return withTelemetry(
    { routeTag: "dashboard", functionName: "markAllUnmarkedForLessonAction", params: input, authEndTime },
    async () => {
      try {
        const { groupId, lessonId } = MarkAllUnmarkedInputSchema.parse(input)

        const { rows } = await query<{ submission_id: string }>(
          `
            SELECT DISTINCT s.submission_id
            FROM submissions s
            JOIN activities         a  ON a.activity_id = s.activity_id
            JOIN lessons            l  ON l.lesson_id   = a.lesson_id
            JOIN lesson_assignments la ON la.lesson_id  = l.lesson_id
                                      AND la.group_id   = $2
            JOIN group_membership   gm ON gm.group_id   = la.group_id
                                      AND gm.user_id    = s.user_id
            WHERE l.lesson_id = $1
              AND a.type = 'short-text-question'
              AND compute_submission_base_score(s.body, a.type) IS NULL
          `,
          [lessonId, groupId],
        )

        const submissions = (rows ?? []).map((r) => ({ submissionId: r.submission_id }))

        if (submissions.length === 0) {
          return MarkAllUnmarkedResultSchema.parse({ success: true, count: 0, error: null })
        }

        const assignmentId = `${groupId}__${lessonId}`
        await enqueueMarkingTasks(assignmentId, submissions)
        void triggerQueueProcessor()

        return MarkAllUnmarkedResultSchema.parse({ success: true, count: submissions.length, error: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to queue submissions for marking."
        console.error("[dashboard] markAllUnmarkedForLessonAction failed", error)
        return MarkAllUnmarkedResultSchema.parse({ success: false, count: 0, error: message })
      }
    },
  )
}
```

- [ ] **Step 3: Re-export from `src/lib/server-updates.ts`**

Find the existing dashboard export block (around line 320):
```typescript
export {
  readMarkingQueueAction,
  readFlaggedSubmissionsAction,
  readMentionsAction,
  type MarkingQueueItem,
  type FlaggedItem,
  type MentionItem,
} from "./server-actions/dashboard"
```

Add `markAllUnmarkedForLessonAction` to it:
```typescript
export {
  readMarkingQueueAction,
  readFlaggedSubmissionsAction,
  readMentionsAction,
  markAllUnmarkedForLessonAction,
  type MarkingQueueItem,
  type FlaggedItem,
  type MentionItem,
} from "./server-actions/dashboard"
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/leroysalih/nodejs/planner-004 && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors relating to `dashboard.ts` or `server-updates.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server-actions/dashboard.ts src/lib/server-updates.ts
git commit -m "feat: add markAllUnmarkedForLessonAction to dashboard actions"
```

---

## Task 2: `MarkAllButton` client component

**Files:**
- Create: `src/components/teacher-dashboard/mark-all-button.tsx`

### Context

This is a `"use client"` component. It uses:
- `useTransition` from React for pending state
- `useRouter` from `next/navigation` for `router.refresh()`
- `toast` from `sonner` for feedback
- `markAllUnmarkedForLessonAction` from `@/lib/server-updates`
- `Button` from `@/components/ui/button`

### Steps

- [ ] **Step 1: Create `src/components/teacher-dashboard/mark-all-button.tsx`**

```typescript
"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { markAllUnmarkedForLessonAction } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"

interface MarkAllButtonProps {
  groupId: string
  lessonId: string
}

export function MarkAllButton({ groupId, lessonId }: MarkAllButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleClick = () => {
    startTransition(async () => {
      const result = await markAllUnmarkedForLessonAction({ groupId, lessonId })

      if (!result.success) {
        toast.error(result.error ?? "Failed to queue submissions for marking.")
        return
      }

      if (result.count === 0) {
        toast.info("No unmarked submissions found.")
        return
      }

      toast.success(`Queued ${result.count} submission${result.count === 1 ? "" : "s"} for marking.`)
      router.refresh()
    })
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="mt-1.5 h-6 border-amber-400/30 px-2 text-xs text-amber-400 hover:border-amber-400 hover:bg-amber-400/10"
      disabled={isPending}
      onClick={handleClick}
    >
      {isPending ? "Queuing…" : "Mark All"}
    </Button>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/leroysalih/nodejs/planner-004 && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/teacher-dashboard/mark-all-button.tsx
git commit -m "feat: add MarkAllButton client component for dashboard"
```

---

## Task 3: Wire `MarkAllButton` into `MarkingQueuePanel`

**Files:**
- Modify: `src/components/teacher-dashboard/marking-queue-panel.tsx`

### Context

`MarkingQueuePanel` is a **server component** — do NOT add `"use client"`. Server components can render client components directly. The button goes inside the right-side `div` of each lesson card, below the activity count.

Current right-side div (lines 46–49):
```tsx
<div className="ml-4 shrink-0 text-right">
  <p className="text-base font-bold text-amber-400">{item.submissionCount}</p>
  <p className="text-xs text-slate-500">activities</p>
</div>
```

### Steps

- [ ] **Step 1: Add the `MarkAllButton` import at the top of `marking-queue-panel.tsx`**

```typescript
import { MarkAllButton } from "@/components/teacher-dashboard/mark-all-button"
```

- [ ] **Step 2: Add `MarkAllButton` inside the right-side div of each card**

Replace:
```tsx
              <div className="ml-4 shrink-0 text-right">
                <p className="text-base font-bold text-amber-400">{item.submissionCount}</p>
                <p className="text-xs text-slate-500">activities</p>
              </div>
```

With:
```tsx
              <div className="ml-4 shrink-0 text-right">
                <p className="text-base font-bold text-amber-400">{item.submissionCount}</p>
                <p className="text-xs text-slate-500">activities</p>
                <MarkAllButton groupId={item.groupId} lessonId={item.lessonId} />
              </div>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/leroysalih/nodejs/planner-004 && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Verify visually**

Navigate to `http://localhost:3000` (or the worktree dev server). The Needs Review panel should show a small "Mark All" button below the activity count on each lesson card. Click one — it should show "Queuing…" then a toast and refresh the count.

- [ ] **Step 5: Commit**

```bash
git add src/components/teacher-dashboard/marking-queue-panel.tsx
git commit -m "feat: add Mark All button to each lesson card in Needs Review panel"
```
