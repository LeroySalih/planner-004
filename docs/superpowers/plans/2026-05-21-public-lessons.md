# Public Lessons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow teachers to mark lessons as public, making them visible to unauthenticated visitors on the sign-in page and via direct links.

**Architecture:** A single `is_public` boolean column on `lessons` gates visibility. The `/signin` page becomes a split layout with a public content browser on the left and the sign-in form on the right. The existing `/lessons/[id]` page gains auth-aware branching — unauthenticated users see a filtered full-width view (static activities only) or are redirected to sign-in. All public rendering reuses existing `LessonActivityView` with `mode="present"`, filtered to non-interactive activity types.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, PostgreSQL via `pg`, Zod, Tailwind CSS v4, Radix UI

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/migrations/applied/071-lesson-is-public.sql` | Create | DB migration — adds `is_public` column |
| `src/types/index.ts` | Modify | Add `is_public` to `LessonSchema` |
| `src/dino.config.ts` | Modify | Add `PUBLIC_ACTIVITY_TYPES` constant |
| `src/lib/server-actions/lessons.ts` | Modify | Add 3 new server actions |
| `src/lib/server-updates.ts` | Modify | Re-export new actions |
| `src/components/public/PublicLessonView.tsx` | Create | Shared presentational renderer for filtered activities |
| `src/components/public/PublicUnitCard.tsx` | Create | Unit card with lesson list for the browser panel |
| `src/components/public/PublicLessonBrowser.tsx` | Create | Client component — manages browser/lesson state + both panels |
| `src/components/public/PublicLessonNav.tsx` | Create | Top nav bar for direct-link public lesson page |
| `src/app/signin/page.tsx` | Modify | Replace single-column form with split layout |
| `src/app/lessons/[lessonId]/page.tsx` | Modify | Add auth-aware branching |
| `src/components/lessons/lesson-header-sidebar.tsx` | Modify | Add `is_public` toggle |

---

## Task 1: Database Migration

**Files:**
- Create: `src/migrations/applied/071-lesson-is-public.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 071-lesson-is-public.sql
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT false NOT NULL;
```

- [ ] **Step 2: Apply the migration**

```bash
psql $DATABASE_URL -f src/migrations/applied/071-lesson-is-public.sql
```

Expected: `ALTER TABLE` with no errors.

- [ ] **Step 3: Verify the column exists**

```bash
psql $DATABASE_URL -c "\d public.lessons"
```

Expected: `is_public | boolean | not null | false` in the column list.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/applied/071-lesson-is-public.sql
git commit -m "feat(db): add is_public column to lessons"
```

---

## Task 2: Update LessonSchema Zod Type

**Files:**
- Modify: `src/types/index.ts:393-399`

- [ ] **Step 1: Add `is_public` to `LessonSchema`**

Find the `LessonSchema` definition (currently at line ~393):

```ts
// BEFORE
export const LessonSchema = z.object({
    lesson_id: z.string(),
    unit_id: z.string(),
    title: z.string().min(1).max(255),
    order_by: z.number().default(0),
    active: z.boolean().default(true),
});
```

Replace with:

```ts
// AFTER
export const LessonSchema = z.object({
    lesson_id: z.string(),
    unit_id: z.string(),
    title: z.string().min(1).max(255),
    order_by: z.number().default(0),
    active: z.boolean().default(true),
    is_public: z.boolean().default(false),
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: No errors related to `is_public`.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add is_public to LessonSchema"
```

---

## Task 3: Add PUBLIC_ACTIVITY_TYPES to dino.config.ts

**Files:**
- Modify: `src/dino.config.ts`

- [ ] **Step 1: Add the constant after existing activity type definitions**

Open `src/dino.config.ts`. After the `NON_SCORABLE_ACTIVITY_TYPES` and `isScorableActivityType` definitions, append:

```ts
// Activity types shown to unauthenticated public visitors.
// Excludes interactive/pupil-specific types (file-download, share-my-work,
// review-others-work, voice) even though they are non-scorable.
export const PUBLIC_ACTIVITY_TYPES = [
  "text",
  "display-image",
  "show-video",
  "display-section",
  "display-flashcards",
] as const

export type PublicActivityType = (typeof PUBLIC_ACTIVITY_TYPES)[number]

export function isPublicActivityType(type: string): type is PublicActivityType {
  return (PUBLIC_ACTIVITY_TYPES as readonly string[]).includes(type)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/dino.config.ts
git commit -m "feat(config): add PUBLIC_ACTIVITY_TYPES for unauthenticated lesson views"
```

---

## Task 4: Server Actions — readPublicLessonsAction, readPublicLessonActivitiesAction, toggleLessonPublicAction

**Files:**
- Modify: `src/lib/server-actions/lessons.ts`
- Modify: `src/lib/server-updates.ts`

- [ ] **Step 1: Add a `PublicLesson` type at the top of lessons.ts**

Open `src/lib/server-actions/lessons.ts`. Near the top with other type definitions, add:

```ts
export type PublicLesson = {
  curriculumId: string
  curriculumTitle: string
  unitId: string
  unitTitle: string
  lessonId: string
  lessonTitle: string
}
```

- [ ] **Step 2: Add `readPublicLessonsAction` at the bottom of lessons.ts**

```ts
export async function readPublicLessonsAction(): Promise<{
  data: PublicLesson[] | null
  error: string | null
}> {
  try {
    const result = await query<{
      curriculum_id: string
      curriculum_title: string
      unit_id: string
      unit_title: string
      lesson_id: string
      lesson_title: string
    }>(
      `SELECT
        c.curriculum_id,
        c.title  AS curriculum_title,
        u.unit_id,
        u.title  AS unit_title,
        l.lesson_id,
        l.title  AS lesson_title
       FROM lessons l
       JOIN units u       ON u.unit_id       = l.unit_id
       JOIN curricula c   ON c.curriculum_id = u.curriculum_id
       WHERE l.is_public = true
         AND l.active    = true
         AND u.active    = true
       ORDER BY c.title, u.order_by, l.order_by`,
      [],
    )
    const data: PublicLesson[] = result.rows.map((row) => ({
      curriculumId:    row.curriculum_id,
      curriculumTitle: row.curriculum_title,
      unitId:          row.unit_id,
      unitTitle:       row.unit_title,
      lessonId:        row.lesson_id,
      lessonTitle:     row.lesson_title,
    }))
    return { data, error: null }
  } catch (err) {
    console.error("[lessons] readPublicLessonsAction error", err)
    return { data: null, error: "Failed to load public lessons" }
  }
}
```

- [ ] **Step 3: Add `readPublicLessonActivitiesAction` at the bottom of lessons.ts**

This reuses the existing internal `loadLessonDetailBootstrapPayload` helper (already defined in the file around line 2045) and adds a public-access guard.

```ts
export async function readPublicLessonActivitiesAction(lessonId: string): Promise<{
  data: import("@/types").LessonActivities | null
  error: string | null
}> {
  try {
    const guardResult = await query<{ is_public: boolean; active: boolean }>(
      "SELECT is_public, active FROM lessons WHERE lesson_id = $1",
      [lessonId],
    )
    const row = guardResult.rows[0]
    if (!row || !row.is_public || !row.active) {
      return { data: null, error: "Lesson not found or not public" }
    }
    const payload = await loadLessonDetailBootstrapPayload(lessonId)
    return { data: payload.lessonActivities ?? [], error: null }
  } catch (err) {
    console.error("[lessons] readPublicLessonActivitiesAction error", err)
    return { data: null, error: "Failed to load lesson activities" }
  }
}
```

- [ ] **Step 4: Add `toggleLessonPublicAction` at the bottom of lessons.ts**

```ts
export async function toggleLessonPublicAction(
  lessonId: string,
  isPublic: boolean,
): Promise<{ data: null; error: string | null }> {
  try {
    await requireRole("teacher")
    await query(
      "UPDATE lessons SET is_public = $1 WHERE lesson_id = $2",
      [isPublic, lessonId],
    )
    revalidatePath(`/lessons/${lessonId}`)
    return { data: null, error: null }
  } catch (err) {
    console.error("[lessons] toggleLessonPublicAction error", err)
    return { data: null, error: "Failed to update lesson visibility" }
  }
}
```

Note: `requireRole` and `revalidatePath` are already imported at the top of `lessons.ts`. Verify with `grep -n "^import\|requireRole\|revalidatePath" src/lib/server-actions/lessons.ts | head -20`.

- [ ] **Step 5: Re-export the three new actions from server-updates.ts**

Open `src/lib/server-updates.ts`. At the bottom, add a new export block:

```ts
export {
  readPublicLessonsAction,
  readPublicLessonActivitiesAction,
  toggleLessonPublicAction,
} from "./server-actions/lessons"
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server-actions/lessons.ts src/lib/server-updates.ts
git commit -m "feat(actions): add readPublicLessonsAction, readPublicLessonActivitiesAction, toggleLessonPublicAction"
```

---

## Task 5: PublicLessonView Component

**Files:**
- Create: `src/components/public/PublicLessonView.tsx`

This is a shared presentational component. It receives a filtered activity list and renders each one using the existing `LessonActivityView` with `mode="present"`. It is used in both the sign-in page inline view and the direct-link lesson page.

- [ ] **Step 1: Create `src/components/public/PublicLessonView.tsx`**

```tsx
"use client"

import type { LessonActivities } from "@/types"
import { isPublicActivityType } from "@/dino.config"
import { LessonActivityView } from "@/components/lessons/activity-view"

interface PublicLessonViewProps {
  activities: LessonActivities
  lessonId: string
}

export function PublicLessonView({ activities, lessonId }: PublicLessonViewProps) {
  const visible = activities
    .filter((a) => a.active !== false && isPublicActivityType(a.type ?? ""))
    .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))

  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No public content available for this lesson.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {visible.map((activity) => (
        <div key={activity.activity_id}>
          {activity.title ? (
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {activity.title}
            </p>
          ) : null}
          <LessonActivityView
            mode="present"
            activity={activity}
            lessonId={lessonId}
            files={[]}
            onDownloadFile={() => {}}
          />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/public/PublicLessonView.tsx
git commit -m "feat(public): add PublicLessonView component"
```

---

## Task 6: PublicUnitCard Component

**Files:**
- Create: `src/components/public/PublicUnitCard.tsx`

- [ ] **Step 1: Create `src/components/public/PublicUnitCard.tsx`**

```tsx
"use client"

import type { PublicLesson } from "@/lib/server-actions/lessons"

interface PublicUnitCardProps {
  unitTitle: string
  curriculumTitle: string
  lessons: PublicLesson[]
  onSelectLesson: (lesson: PublicLesson) => void
}

export function PublicUnitCard({
  unitTitle,
  curriculumTitle,
  lessons,
  onSelectLesson,
}: PublicUnitCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <p className="font-semibold text-foreground">{unitTitle}</p>
        <p className="text-xs text-muted-foreground">{curriculumTitle}</p>
      </div>
      <ul className="space-y-1">
        {lessons.map((lesson) => (
          <li key={lesson.lessonId}>
            <button
              type="button"
              onClick={() => onSelectLesson(lesson)}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              📄 {lesson.lessonTitle}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/components/public/PublicUnitCard.tsx
git commit -m "feat(public): add PublicUnitCard component"
```

---

## Task 7: PublicLessonBrowser Component

**Files:**
- Create: `src/components/public/PublicLessonBrowser.tsx`

This is the main client component for the sign-in page. It manages all state — which curriculum filter is active, which lesson is selected, and loading state. It renders both the left panel and the right panel.

- [ ] **Step 1: Create `src/components/public/PublicLessonBrowser.tsx`**

```tsx
"use client"

import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import type { PublicLesson } from "@/lib/server-actions/lessons"
import type { LessonActivities } from "@/types"
import { readPublicLessonActivitiesAction } from "@/lib/server-updates"
import { SigninForm } from "@/components/signin"
import { PublicUnitCard } from "@/components/public/PublicUnitCard"
import { PublicLessonView } from "@/components/public/PublicLessonView"
import { Button } from "@/components/ui/button"
import Link from "next/link"

interface SelectedLesson {
  lessonId: string
  lessonTitle: string
  unitTitle: string
  curriculumTitle: string
  activities: LessonActivities
}

interface PublicLessonBrowserProps {
  lessons: PublicLesson[]
  returnTo?: string
}

export function PublicLessonBrowser({ lessons, returnTo }: PublicLessonBrowserProps) {
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const [selectedLesson, setSelectedLesson] = useState<SelectedLesson | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const curricula = useMemo(() => {
    const map = new Map<string, string>()
    lessons.forEach((l) => map.set(l.curriculumId, l.curriculumTitle))
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }))
  }, [lessons])

  const filteredUnits = useMemo(() => {
    const filtered =
      activeFilter === "all"
        ? lessons
        : lessons.filter((l) => l.curriculumId === activeFilter)

    const unitMap = new Map<
      string,
      { unitId: string; unitTitle: string; curriculumTitle: string; lessons: PublicLesson[] }
    >()
    filtered.forEach((l) => {
      if (!unitMap.has(l.unitId)) {
        unitMap.set(l.unitId, {
          unitId: l.unitId,
          unitTitle: l.unitTitle,
          curriculumTitle: l.curriculumTitle,
          lessons: [],
        })
      }
      unitMap.get(l.unitId)!.lessons.push(l)
    })
    return Array.from(unitMap.values())
  }, [lessons, activeFilter])

  const handleSelectLesson = async (lesson: PublicLesson) => {
    setIsLoading(true)
    const result = await readPublicLessonActivitiesAction(lesson.lessonId)
    setIsLoading(false)
    if (result.data) {
      setSelectedLesson({
        lessonId: lesson.lessonId,
        lessonTitle: lesson.lessonTitle,
        unitTitle: lesson.unitTitle,
        curriculumTitle: lesson.curriculumTitle,
        activities: result.data,
      })
    }
  }

  const handleBack = () => setSelectedLesson(null)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left panel */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-border">
        {selectedLesson ? (
          /* State 2: inline lesson view */
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-border px-6 py-4">
              <button
                type="button"
                onClick={handleBack}
                className="text-sm text-primary hover:underline"
              >
                ← Back to lessons
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <p className="mb-1 text-xs text-muted-foreground">
                {selectedLesson.curriculumTitle} › {selectedLesson.unitTitle}
              </p>
              <h2 className="mb-6 text-2xl font-bold text-foreground">
                {selectedLesson.lessonTitle}
              </h2>
              <PublicLessonView
                activities={selectedLesson.activities}
                lessonId={selectedLesson.lessonId}
              />
            </div>
          </div>
        ) : (
          /* State 1: curriculum browser */
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Fixed header */}
            <div className="flex-shrink-0 border-b border-border px-6 py-5">
              <h2 className="text-lg font-bold text-foreground">Browse Lessons</h2>
              <p className="text-sm text-muted-foreground">
                Public lessons from our curriculum
              </p>
            </div>
            {/* Fixed filter chips */}
            <div className="flex-shrink-0 flex flex-wrap gap-2 px-6 py-3 border-b border-border">
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                All
              </button>
              {curricula.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveFilter(c.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    activeFilter === c.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {c.title}
                </button>
              ))}
            </div>
            {/* Scrollable unit cards */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading lesson…
                </div>
              ) : filteredUnits.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No public lessons available.
                </p>
              ) : (
                <div className="space-y-4">
                  {filteredUnits.map((unit) => (
                    <PublicUnitCard
                      key={unit.unitId}
                      unitTitle={unit.unitTitle}
                      curriculumTitle={unit.curriculumTitle}
                      lessons={unit.lessons}
                      onSelectLesson={handleSelectLesson}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right panel — fixed width, never scrolls */}
      <div className="flex w-80 flex-shrink-0 flex-col justify-center gap-6 p-8">
        {selectedLesson ? (
          /* State 2 right: sign-in prompt */
          <div className="flex flex-col gap-4 text-center">
            <h3 className="text-lg font-bold text-foreground">Want to do more?</h3>
            <p className="text-sm text-muted-foreground">
              Sign in to attempt activities, track your progress, and access all lessons.
            </p>
            <Button asChild className="w-full">
              <Link href="/signin">Sign in →</Link>
            </Button>
          </div>
        ) : (
          /* State 1 right: full sign-in form */
          <>
            <div>
              <h2 className="text-xl font-bold text-foreground">Sign in to Dino</h2>
              <p className="text-sm text-muted-foreground">
                Enter your email and password to continue.
              </p>
            </div>
            <SigninForm returnTo={returnTo} />
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: No errors. If there are import errors for `SigninForm`, verify the import path matches the existing component at `src/components/signin/index.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/public/PublicLessonBrowser.tsx
git commit -m "feat(public): add PublicLessonBrowser component"
```

---

## Task 8: Redesign Sign-in Page

**Files:**
- Modify: `src/app/signin/page.tsx`

- [ ] **Step 1: Replace the sign-in page**

```tsx
import type { Metadata } from "next"
import { readPublicLessonsAction } from "@/lib/server-updates"
import { PublicLessonBrowser } from "@/components/public/PublicLessonBrowser"

export const metadata: Metadata = {
  title: "Sign in",
}

export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>
}) {
  const { returnTo } = await searchParams
  const { data: lessons } = await readPublicLessonsAction()

  return (
    <PublicLessonBrowser lessons={lessons ?? []} returnTo={returnTo} />
  )
}
```

Note: The existing `<main>` wrapper, header, and "Back to home" link are removed — the new layout is full-screen. The `PublicLessonBrowser` owns the entire viewport.

- [ ] **Step 2: Check for layout wrapper conflicts**

The sign-in page lives inside a layout. Check the parent layout file:

```bash
cat src/app/signin/layout.tsx 2>/dev/null || cat src/app/layout.tsx | head -40
```

If the root layout wraps content in a container that constrains width, verify the full-screen layout still works. The `PublicLessonBrowser` uses `h-screen overflow-hidden` — if there's a padding/container wrapping it, the `h-screen` may not reach full height. If needed, add `overflow: hidden` to the layout's root element or use `h-dvh` instead of `h-screen`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Start dev server and manually verify the sign-in page**

```bash
pnpm dev
```

Open `http://localhost:3000/signin` (or the worktree port). Verify:
- Left panel shows "Browse Lessons" header + filter chips + unit cards (if any lessons are public)
- Right panel shows the sign-in form
- Filter chips change the unit card list
- Left panel scrolls while right panel stays fixed
- If no lessons are public yet, left panel shows "No public lessons available."

- [ ] **Step 5: Commit**

```bash
git add src/app/signin/page.tsx
git commit -m "feat(signin): redesign as split layout with public lesson browser"
```

---

## Task 9: PublicLessonNav Component

**Files:**
- Create: `src/components/public/PublicLessonNav.tsx`

This is the top navigation bar shown on the direct-link public lesson page.

- [ ] **Step 1: Create `src/components/public/PublicLessonNav.tsx`**

```tsx
import Link from "next/link"
import { Button } from "@/components/ui/button"

export function PublicLessonNav() {
  return (
    <nav className="flex items-center justify-between border-b border-border bg-background px-6 py-3">
      <Link href="/" className="text-lg font-bold text-foreground">
        🦕 Dino
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground hidden sm:block">
          Want to track your progress?
        </span>
        <Button asChild size="sm">
          <Link href="/signin">Sign in</Link>
        </Button>
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/public/PublicLessonNav.tsx
git commit -m "feat(public): add PublicLessonNav component"
```

---

## Task 10: Lesson Page — Auth-Aware Rendering

**Files:**
- Modify: `src/app/lessons/[lessonId]/page.tsx`

When an unauthenticated user visits a public lesson, they see `PublicLessonNav` + `PublicLessonView` + a bottom sign-in nudge. For a private lesson they are redirected to sign-in with a `returnTo` param.

- [ ] **Step 1: Update the lesson page**

Replace the entire contents of `src/app/lessons/[lessonId]/page.tsx` with:

```tsx
export const dynamic = "force-dynamic"

import { redirect, notFound } from "next/navigation"
import { LessonDetailClient } from "@/components/lessons/lesson-detail-client"
import { PublicLessonView } from "@/components/public/PublicLessonView"
import { PublicLessonNav } from "@/components/public/PublicLessonNav"
import {
  readAllLearningObjectivesAction,
  readLessonDetailBootstrapAction,
  readLessonReferenceDataAction,
  readPublicLessonActivitiesAction,
} from "@/lib/server-updates"
import { getAuthenticatedProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"

export default async function LessonDetailPage({
  params,
}: {
  params: Promise<{ lessonId: string }>
}) {
  const { lessonId } = await params

  const profile = await getAuthenticatedProfile()

  if (!profile) {
    // Unauthenticated: check if lesson is public
    const publicResult = await readPublicLessonActivitiesAction(lessonId)

    if (publicResult.error || !publicResult.data) {
      // Not public or not found — redirect to sign-in
      redirect(`/signin?returnTo=/lessons/${lessonId}`)
    }

    // Public lesson — fetch breadcrumb info from bootstrap (no auth required)
    const lessonDetailResult = await readLessonDetailBootstrapAction(lessonId)
    const lesson = lessonDetailResult.data?.lesson
    if (!lesson) {
      notFound()
    }

    const referenceResult = await readLessonReferenceDataAction(lessonId)
    const curriculum = referenceResult.data?.curricula?.[0]

    return (
      <div className="flex flex-col min-h-screen">
        <PublicLessonNav />
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
          {/* Breadcrumb */}
          <p className="mb-2 text-xs text-muted-foreground">
            {curriculum?.title ? `${curriculum.title} › ` : ""}
            {lessonDetailResult.data?.unit?.title ?? ""}
          </p>
          <h1 className="mb-8 text-3xl font-bold text-foreground">{lesson.title}</h1>

          <PublicLessonView
            activities={publicResult.data}
            lessonId={lessonId}
          />

          {/* Bottom sign-in nudge */}
          <div className="mt-12 flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-6 py-5">
            <div>
              <p className="font-semibold text-foreground">Continue learning with Dino</p>
              <p className="text-sm text-muted-foreground">
                Attempt activities, track your progress, and access all lessons.
              </p>
            </div>
            <a
              href="/signin"
              className="flex-shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Sign in →
            </a>
          </div>
        </main>
      </div>
    )
  }

  // Authenticated: existing full lesson flow unchanged
  const authEnd: number | null = null

  const lessonDetailResult = await withTelemetry(
    {
      routeTag: "/lessons/[lessonId]",
      functionName: "LessonDetailPage.lessonBootstrap",
      params: { lessonId },
      authEndTime: authEnd,
    },
    () =>
      readLessonDetailBootstrapAction(lessonId, {
        routeTag: "/lessons/[lessonId]",
        authEndTime: authEnd,
      }),
  )

  if (lessonDetailResult.error) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="mb-4 text-2xl font-bold">Error Loading Lesson</h1>
        <p className="text-red-600">{lessonDetailResult.error}</p>
      </div>
    )
  }

  const lessonPayload = lessonDetailResult.data
  const lesson = lessonPayload?.lesson
  if (!lesson) {
    notFound()
  }

  const referenceResult = await withTelemetry(
    {
      routeTag: "/lessons/[lessonId]",
      functionName: "LessonDetailPage.loadReferenceData",
      params: { lessonId, unitId: lesson.unit_id },
      authEndTime: authEnd,
    },
    () =>
      readLessonReferenceDataAction(lesson.lesson_id, {
        routeTag: "/lessons/[lessonId]",
        authEndTime: authEnd,
      }),
  )

  const curriculumIds =
    referenceResult.data?.curricula?.map((c) => c.curriculum_id).filter((id): id is string => Boolean(id)) ?? []

  const learningObjectivesResult = await readAllLearningObjectivesAction({
    routeTag: "/lessons/[lessonId]",
    authEndTime: authEnd,
    curriculumIds,
    unitId: lesson.unit_id,
  })

  if (referenceResult.error || learningObjectivesResult.error) {
    return (
      <div className="container mx-auto space-y-4 p-6">
        {referenceResult.error && (
          <div>
            <h2 className="text-xl font-semibold">Error Loading Curricula or Assessment Objectives</h2>
            <p className="text-red-600">{referenceResult.error}</p>
          </div>
        )}
        {learningObjectivesResult.error && (
          <div>
            <h2 className="text-xl font-semibold">Error Loading Learning Objectives</h2>
            <p className="text-red-600">{learningObjectivesResult.error}</p>
          </div>
        )}
      </div>
    )
  }

  const unitLessons = (lessonPayload?.unitLessons ?? []).slice().sort((a, b) => {
    const orderCompare = (a.order_by ?? 0) - (b.order_by ?? 0)
    if (orderCompare !== 0) return orderCompare
    return a.title.localeCompare(b.title)
  })

  const lessonOptions = unitLessons.map((item) => ({
    lesson_id: item.lesson_id,
    title: item.title,
  }))

  const allowedCurriculumIds = new Set(
    (referenceResult.data?.curricula ?? [])
      .map((curriculum) => curriculum.curriculum_id)
      .filter((id): id is string => Boolean(id)),
  )

  const curriculumLearningObjectives =
    allowedCurriculumIds.size === 0
      ? learningObjectivesResult.data ?? []
      : (learningObjectivesResult.data ?? []).filter((objective) => {
          const curriculumId =
            objective.assessment_objective_curriculum_id ??
            objective.assessment_objective?.curriculum_id ??
            null
          return curriculumId ? allowedCurriculumIds.has(curriculumId) : false
        })

  return (
    <LessonDetailClient
      lesson={lesson}
      unit={lessonPayload?.unit ?? null}
      learningObjectives={curriculumLearningObjectives}
      curricula={referenceResult.data?.curricula ?? []}
      assessmentObjectives={referenceResult.data?.assessmentObjectives ?? []}
      lessonFiles={lessonPayload?.lessonFiles ?? []}
      lessonActivities={lessonPayload?.lessonActivities ?? []}
      unitLessons={lessonOptions}
    />
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Manually verify both paths**

With the dev server running:

1. Visit `/lessons/[any-private-lessonId]` without being signed in → should redirect to `/signin?returnTo=/lessons/[id]`
2. Mark a lesson as public (you'll do this in Task 12), then visit its URL without signing in → should show the public view with nav bar and bottom nudge

- [ ] **Step 4: Commit**

```bash
git add src/app/lessons/[lessonId]/page.tsx
git commit -m "feat(lessons): add auth-aware rendering for public lesson direct links"
```

---

## Task 11: is_public Toggle in Lesson Header Sidebar

**Files:**
- Modify: `src/components/lessons/lesson-header-sidebar.tsx`

The sidebar already has a Switch for `active`. Add a second Switch for `is_public` using the same `useTransition` + direct action call pattern.

- [ ] **Step 1: Read the full current sidebar file**

```bash
cat src/components/lessons/lesson-header-sidebar.tsx
```

You need to see all current state and submit logic before editing.

- [ ] **Step 2: Add `isPublic` state and toggle handler**

In `LessonHeaderSidebar`, after the existing `const [isActive, setIsActive] = useState(lesson.active !== false)` line, add:

```ts
const [isPublic, setIsPublic] = useState(lesson.is_public ?? false)
const [isPublicPending, startPublicTransition] = useTransition()
```

Import `toggleLessonPublicAction` at the top of the file:

```ts
import { updateLessonHeaderAction, toggleLessonPublicAction } from "@/lib/server-updates"
```

Add the toggle handler after the existing state declarations:

```ts
const handleTogglePublic = (checked: boolean) => {
  setIsPublic(checked)
  startPublicTransition(async () => {
    const result = await toggleLessonPublicAction(lesson.lesson_id, checked)
    if (result.error) {
      setIsPublic(!checked) // revert on error
      toast.error(result.error)
    } else {
      toast.success(checked ? "Lesson is now public." : "Lesson is now private.")
    }
  })
}
```

- [ ] **Step 3: Add the Switch to the sidebar JSX**

Find the section in the return JSX where the `active` Switch is rendered (it will look like a `<Switch>` with a label). After that Switch block, add the public toggle:

```tsx
<div className="flex items-center gap-3">
  <Switch
    id={`lesson-public-${lesson.lesson_id}`}
    checked={isPublic}
    disabled={isPublicPending}
    onCheckedChange={handleTogglePublic}
  />
  <Label htmlFor={`lesson-public-${lesson.lesson_id}`} className="text-sm font-medium">
    Public lesson
  </Label>
  {isPublicPending ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
  ) : null}
</div>
```

`Loader2` is already imported in this file (verify with `grep "Loader2" src/components/lessons/lesson-header-sidebar.tsx`). If not, add it to the `lucide-react` import.

- [ ] **Step 4: Sync `isPublic` state when sidebar reopens**

In the existing `useEffect` that resets form state when `isOpen` changes, add `is_public`:

```ts
useEffect(() => {
  if (!isOpen) return
  setTitle(lesson.title ?? "")
  setIsActive(lesson.active !== false)
  setIsPublic(lesson.is_public ?? false)  // add this line
}, [isOpen, lesson])
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Manually test the toggle**

1. Sign in as a teacher
2. Open a lesson
3. Open the lesson header sidebar (edit button)
4. Verify the "Public lesson" Switch appears
5. Toggle it on → lesson should now be visible in the sign-in page browser
6. Sign out and visit `/signin` → lesson should appear in the left panel
7. Click the lesson → it loads inline, right panel shows "Want to do more?"
8. Click "Sign in →" → returns to sign-in page with full form
9. Visit `/lessons/[id]` while signed out → public view renders
10. Toggle `is_public` off → lesson disappears from the browser and direct link redirects to sign-in

- [ ] **Step 7: Commit**

```bash
git add src/components/lessons/lesson-header-sidebar.tsx
git commit -m "feat(lessons): add is_public toggle to lesson header sidebar"
```

---

## Task 12: End-to-End Playwright Test

**Files:**
- Create: `tests/public-lessons/public-lessons.spec.ts`

- [ ] **Step 1: Record test environment setup**

Check `tests/.env.test` for the test database URL and credentials. Ensure a test lesson with `is_public = true` can be set up, or seed one in the test.

- [ ] **Step 2: Create the test file**

```ts
import { test, expect } from "@playwright/test"

// These tests require at least one lesson marked is_public = true in the test DB.
// Run: psql $TEST_DATABASE_URL -c "UPDATE lessons SET is_public = true WHERE lesson_id = (SELECT lesson_id FROM lessons LIMIT 1)"
// and record the lesson_id below.

const PUBLIC_LESSON_ID = process.env.TEST_PUBLIC_LESSON_ID ?? ""

test.describe("Public lessons", () => {
  test.beforeAll(async () => {
    if (!PUBLIC_LESSON_ID) {
      test.skip()
    }
  })

  test("sign-in page shows public lesson browser", async ({ page }) => {
    await page.goto("/signin")
    await expect(page.getByText("Browse Lessons")).toBeVisible()
    await expect(page.getByText("Sign in to Dino")).toBeVisible()
  })

  test("clicking a public lesson loads it inline", async ({ page }) => {
    await page.goto("/signin")
    const lessonLink = page.locator("button").filter({ hasText: "📄" }).first()
    await expect(lessonLink).toBeVisible()
    await lessonLink.click()
    await expect(page.getByText("Back to lessons")).toBeVisible()
    await expect(page.getByText("Want to do more?")).toBeVisible()
    await expect(page.getByRole("link", { name: /Sign in/i })).toBeVisible()
  })

  test("back button returns to browser state", async ({ page }) => {
    await page.goto("/signin")
    const lessonLink = page.locator("button").filter({ hasText: "📄" }).first()
    await lessonLink.click()
    await page.getByText("Back to lessons").click()
    await expect(page.getByText("Browse Lessons")).toBeVisible()
    await expect(page.getByText("Sign in to Dino")).toBeVisible()
  })

  test("direct link to public lesson shows public view", async ({ page }) => {
    await page.goto(`/lessons/${PUBLIC_LESSON_ID}`)
    await expect(page.getByText("Sign in")).toBeVisible()
    await expect(page.getByText("Continue learning with Dino")).toBeVisible()
    // Verify no scorable activity types are rendered
    await expect(page.getByText("Multiple choice")).not.toBeVisible()
    await expect(page.getByText("Short text question")).not.toBeVisible()
  })

  test("direct link to private lesson redirects to sign-in", async ({ page }) => {
    // Use a lesson that does NOT have is_public = true
    const PRIVATE_LESSON_ID = process.env.TEST_PRIVATE_LESSON_ID ?? ""
    if (!PRIVATE_LESSON_ID) test.skip()
    await page.goto(`/lessons/${PRIVATE_LESSON_ID}`)
    await expect(page).toHaveURL(/\/signin/)
  })
})
```

- [ ] **Step 3: Set TEST_PUBLIC_LESSON_ID in tests/.env.test**

```bash
# In tests/.env.test, add:
TEST_PUBLIC_LESSON_ID=<the lesson_id of a public lesson in your test DB>
TEST_PRIVATE_LESSON_ID=<the lesson_id of a private lesson>
```

- [ ] **Step 4: Run the tests**

```bash
pnpm test tests/public-lessons/public-lessons.spec.ts
```

Expected: All tests pass (or skip gracefully if env vars are not set).

- [ ] **Step 5: Commit**

```bash
git add tests/public-lessons/public-lessons.spec.ts tests/.env.test
git commit -m "test: add Playwright tests for public lesson flows"
```

---

## Self-Review Checklist

- [x] **spec: Database changes** — Task 1 adds `is_public` column, Task 2 updates Zod type
- [x] **spec: readPublicLessonsAction** — Task 4 step 2
- [x] **spec: readPublicLessonActivitiesAction** — Task 4 step 3
- [x] **spec: toggleLessonPublicAction** — Task 4 step 4
- [x] **spec: Sign-in page left panel State 1** — Tasks 6–8 (PublicUnitCard, PublicLessonBrowser, page.tsx)
- [x] **spec: Sign-in page left panel State 2** — Task 7 (selectedLesson branch in PublicLessonBrowser)
- [x] **spec: Sign-in page right panel State 2 shows sign-in button** — Task 7 (right panel branch)
- [x] **spec: Left panel scrolls, right panel fixed** — Task 7 (`overflow-y-auto` on unit cards, `flex-shrink-0` on right panel)
- [x] **spec: Direct link public lesson** — Tasks 9–10 (PublicLessonNav + lesson page update)
- [x] **spec: Direct link private lesson redirects** — Task 10 (redirect branch)
- [x] **spec: Scorable activities invisible** — Task 5 (PublicLessonView filters with isPublicActivityType)
- [x] **spec: Teacher toggle** — Task 11 (lesson-header-sidebar.tsx)
- [x] **spec: PUBLIC_ACTIVITY_TYPES** — Task 3 (dino.config.ts)
- [x] **type consistency** — `PublicLesson` type defined in Task 4 step 1 and used throughout Tasks 6–8; `LessonActivities` type used in Task 5 and 7; `toggleLessonPublicAction` signature matches usage in Task 11
