# Display Section Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new non-scorable `display-section` activity type that marks the start of a section within a lesson, with an auto-computed section index shown in both list and presentation views.

**Architecture:** New activity type registered alongside existing non-scorable types. Body stored as `{ description: string }` rich text, title uses the existing activity `title` column. Section index is computed at render time by walking the `order_by`-sorted activity list and counting preceding `display-section` activities; passed to view components via a new optional `sectionIndex` prop.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Zod, PostgreSQL (existing `activities` table, no migration), existing `RichTextEditor` component, `marked` via `getRichTextMarkup()`.

**Testing note:** This repo has no unit test infrastructure (per `CLAUDE.md`). Verification is done via `pnpm lint`, `pnpm build` (type-check), and manual exercise in the dev server. A minimal Playwright E2E is added in the final task.

**Spec:** `docs/superpowers/specs/2026-04-24-display-section-activity-design.md`

---

## Task 1: Register `display-section` as a non-scorable activity type

**Files:**
- Modify: `src/dino.config.ts:13-22`

- [ ] **Step 1: Add the new type to `NON_SCORABLE_ACTIVITY_TYPES`**

Edit `src/dino.config.ts`. Find the `NON_SCORABLE_ACTIVITY_TYPES` array (lines 13-22) and add `"display-section"` as a new entry. Final array:

```ts
export const NON_SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "text",
  "display-image",
  "display-flashcards",
  "file-download",
  "show-video",
  "voice",
  "share-my-work",
  "review-others-work",
  "display-section",
]);
```

- [ ] **Step 2: Verify type-check passes**

Run: `pnpm build`
Expected: build succeeds (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/dino.config.ts
git commit -m "feat(activities): register display-section as non-scorable type"
```

---

## Task 2: Add server-side body validation for `display-section`

**Files:**
- Modify: `src/lib/server-actions/lesson-activities.ts` (add schema near other body schemas; add case in `normalizeActivityBody()` switch at line 925)

- [ ] **Step 1: Add the Zod body schema**

In `src/lib/server-actions/lesson-activities.ts`, locate the existing body schema declarations (search for `McqActivityBodySchema` — other body schemas live near it). Add this schema immediately after the existing non-MCQ body schemas (before `normalizeActivityBody`):

```ts
const DisplaySectionActivityBodySchema = z.object({
  description: z.string().default(""),
});
```

- [ ] **Step 2: Add a case in `normalizeActivityBody()`**

In the same file, locate `normalizeActivityBody` (starts line 911). Inside the `switch (trimmed) { ... }` block (line 925), add a new case before the `default` branch:

```ts
case "display-section": {
  const parsed = DisplaySectionActivityBodySchema.safeParse(bodyData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid display-section activity body.",
    };
  }
  return { success: true, bodyData: parsed.data };
}
```

- [ ] **Step 3: Verify type-check passes**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server-actions/lesson-activities.ts
git commit -m "feat(activities): validate display-section body_data"
```

---

## Task 3: Add view utilities — `getDisplaySectionBody` and `computeSectionIndexMap`

**Files:**
- Modify: `src/components/lessons/activity-view/utils.ts` (append at end of file, before `getYouTubeVideoId` is fine, or just at EOF)

- [ ] **Step 1: Add the body extractor**

In `src/components/lessons/activity-view/utils.ts`, add the following exports at the end of the file (after `getFlashcardsText` and before `getRichTextMarkup` is fine, or at end of file — either is acceptable since order is free):

```ts
export interface DisplaySectionBody {
  description: string;
}

export function getDisplaySectionBody(
  activity: LessonActivity,
): DisplaySectionBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { description: "" };
  }
  const record = activity.body_data as Record<string, unknown>;
  const description = typeof record.description === "string"
    ? record.description
    : "";
  return { description };
}
```

- [ ] **Step 2: Add the index map builder**

In the same file, add:

```ts
export function computeSectionIndexMap(
  activities: LessonActivity[],
): Map<string, number> {
  const sorted = [...activities].sort(
    (a, b) => (a.order_by ?? 0) - (b.order_by ?? 0),
  );
  const map = new Map<string, number>();
  let index = 0;
  for (const activity of sorted) {
    if (activity.type === "display-section" && typeof activity.activity_id === "string") {
      index += 1;
      map.set(activity.activity_id, index);
    }
  }
  return map;
}
```

- [ ] **Step 3: Verify type-check passes**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/lessons/activity-view/utils.ts
git commit -m "feat(activities): add display-section view utilities"
```

---

## Task 4: Wire `sectionIndex` prop and render short view

**Files:**
- Modify: `src/components/lessons/activity-view/index.tsx` (props interface at line 78-87; short view render branch at line 232-411)

- [ ] **Step 1: Add `sectionIndex` to both view prop interfaces**

In `src/components/lessons/activity-view/index.tsx`, edit `LessonActivityShortViewProps` (line 78) and `LessonActivityPresentViewProps` (line 89) to include the new optional prop. After edit:

```ts
export interface LessonActivityShortViewProps extends LessonActivityViewBaseProps {
  mode: "short"
  resolvedImageUrl?: string | null
  showImageBorder?: boolean
  onSummativeChange?: (nextValue: boolean) => void
  summativeUpdating?: boolean
  summativeDisabled?: boolean
  onImageClick?: (url: string, title: string | null) => void
  onDownloadFile?: () => void
  sectionIndex?: number
}

export interface LessonActivityPresentViewProps extends LessonActivityViewBaseProps {
  mode: "present"
  files: LessonActivityFile[]
  onDownloadFile: (fileName: string) => void
  voicePlayback?: { url: string | null; isLoading: boolean }
  fetchActivityFileUrl?: (activityId: string, fileName: string) => Promise<string | null>
  viewerCanReveal?: boolean
  forceEnableFeedback?: boolean
  sectionIndex?: number
}
```

- [ ] **Step 2: Import `getDisplaySectionBody` in `activity-view/index.tsx`**

Find the existing import line that brings in `getActivityTextValue`, `getRichTextMarkup`, etc. from `./utils` and add `getDisplaySectionBody` to it. Example (exact set will depend on existing imports — add the new name to the existing list):

```ts
import {
  // ... existing imports ...
  getDisplaySectionBody,
} from "./utils"
```

- [ ] **Step 3: Destructure `sectionIndex` in `ActivityShortView`**

Edit `ActivityShortView` signature (line 169-179) to accept the prop:

```ts
function ActivityShortView({
  activity,
  lessonId,
  resolvedImageUrl,
  showImageBorder = true,
  onSummativeChange,
  summativeUpdating = false,
  summativeDisabled = false,
  onImageClick,
  onDownloadFile,
  sectionIndex,
}: LessonActivityShortViewProps) {
```

- [ ] **Step 4: Add the short-view render branch**

Inside the body of `ActivityShortView`, locate the `if (activity.type === "text" ...)` branch (around line 234) that is part of the `if / else if` chain assigning `content`. Add a new branch at the **top** of that chain so it takes precedence:

```tsx
if (activity.type === "display-section") {
  const { description } = getDisplaySectionBody(activity)
  const markup = getRichTextMarkup(description)
  const heading = typeof sectionIndex === "number"
    ? `Section ${sectionIndex}: ${activity.title ?? ""}`.trim()
    : activity.title ?? "Section"
  content = (
    <div className="rounded-lg border-l-4 border-primary bg-primary/5 px-4 py-3">
      <h3 className="text-lg font-semibold text-foreground">{heading}</h3>
      {markup ? (
        <div
          className="prose prose-sm mt-2 max-w-none dark:prose-invert text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      ) : null}
    </div>
  )
} else if (activity.type === "text" || activity.type === "text-question") {
  // ...existing branch unchanged
```

Keep the rest of the existing `if / else if` chain intact — only change the first `if` to `else if` by prepending the new `display-section` branch.

- [ ] **Step 5: Verify type-check passes**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/lessons/activity-view/index.tsx
git commit -m "feat(activities): render display-section in short view"
```

---

## Task 5: Render `display-section` in the presentation view

**Files:**
- Modify: `src/components/lessons/activity-view/index.tsx` (`ActivityPresentView` at line 806)

- [ ] **Step 1: Destructure `sectionIndex` in `ActivityPresentView`**

Edit `ActivityPresentView` signature (line 806-815) to accept the prop:

```ts
function ActivityPresentView({
  activity,
  files,
  onDownloadFile,
  voicePlayback,
  fetchActivityFileUrl,
  viewerCanReveal,
  lessonId,
  forceEnableFeedback,
  sectionIndex,
}: LessonActivityPresentViewProps) {
```

- [ ] **Step 2: Add the present-view render branch**

In `ActivityPresentView`, after the `wrap` helper definition (around line 828) and before the `if (activity.type === "feedback")` branch (line 830), insert:

```tsx
if (activity.type === "display-section") {
  const { description } = getDisplaySectionBody(activity)
  const markup = getRichTextMarkup(description)
  return wrap(
    <div className="space-y-4">
      {typeof sectionIndex === "number" ? (
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          Section {sectionIndex}
        </p>
      ) : null}
      <h1 className="text-4xl font-bold text-foreground">
        {activity.title ?? ""}
      </h1>
      {markup ? (
        <div
          className="prose prose-lg max-w-none dark:prose-invert text-foreground"
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      ) : null}
    </div>,
  )
}
```

- [ ] **Step 3: Verify type-check passes**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/lessons/activity-view/index.tsx
git commit -m "feat(activities): render display-section in presentation view"
```

---

## Task 6: Add editor support for `display-section` in the activities manager

**Files:**
- Modify: `src/components/lessons/lesson-activities-manager.tsx`
  - `ACTIVITY_TYPES` at line 73-91
  - `buildBodyData` at line 1647-1684
  - Create-mode state reset at line 2550
  - Edit-mode state reset at line 2643
  - Editor form body around line 3297

- [ ] **Step 1: Add the type option**

Edit `ACTIVITY_TYPES` (line 73-91). Add a new entry — placement near other `display-*` types keeps the list logical:

```ts
const ACTIVITY_TYPES = [
  { value: "text", label: "Text" },
  { value: "long-text-question", label: "Long text question" },
  { value: "file-download", label: "File download" },
  { value: "upload-file", label: "Upload file" },
  { value: "upload-url", label: "Upload URL" },
  { value: "display-image", label: "Display image" },
  { value: "display-flashcards", label: "Flashcards" },
  { value: "display-section", label: "Display Section" },
  { value: "do-flashcards", label: "Do Flashcards" },
  { value: "show-video", label: "Show video" },
  { value: "multiple-choice-question", label: "Multiple choice question" },
  { value: "short-text-question", label: "Short text question" },
  { value: "feedback", label: "Feedback" },
  { value: "text-question", label: "Text question" },
  { value: "voice", label: "Voice recording" },
  { value: "sketch-render", label: "Render Sketch" },
  { value: "share-my-work", label: "Share my work" },
  { value: "review-others-work", label: "Review others' work" },
] as const
```

- [ ] **Step 2: Extend `buildBodyData` to produce the correct body for `display-section`**

Edit `buildBodyData` (line 1647-1684). Add a branch for `display-section` before the final `return fallback ?? null`:

```ts
if (type === "display-section") {
  return { description: text }
}
```

So the function reads, at the relevant tail:

```ts
  if (type === "display-flashcards") {
    return { lines: text }
  }
  if (type === "display-section") {
    return { description: text }
  }
  return fallback ?? null
}
```

- [ ] **Step 3: Reset `text` state in create mode for `display-section`**

At line 2550, the create-mode `useEffect` has:

```ts
if (type === "text" || type === "text-question" || type === "long-text-question" || type === "upload-file" || type === "sketch-render" || type === "display-flashcards") {
```

Add `display-section` to this check:

```ts
if (
  type === "text" ||
  type === "text-question" ||
  type === "long-text-question" ||
  type === "upload-file" ||
  type === "sketch-render" ||
  type === "display-flashcards" ||
  type === "display-section"
) {
```

The body of the branch (resetting `videoUrl`, `text`, `rawBody`) is already correct for our needs — no further change.

- [ ] **Step 4: Hydrate `text` state in edit mode for `display-section`**

Add an `extractDescription` helper near `extractText` (line 1611). Place it immediately after `extractUploadInstructions` (line 1629):

```ts
function extractDescription(activity: LessonActivity): string {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return ""
  }
  const value = (activity.body_data as Record<string, unknown>).description
  return typeof value === "string" ? value : ""
}
```

Then, in the edit-mode `useEffect` (line 2643 onward), after the existing `if (type === "text" || ... "long-text-question") { ... }` block and its sibling `if (type === "sketch-render") { ... }` block, insert:

```ts
if (type === "display-section") {
  setVideoUrl("")
  setText(activity ? extractDescription(activity) : "")
  setRawBody("")
  return
}
```

- [ ] **Step 5: Show the rich-text editor for `display-section`**

Edit the conditional at line 3297. The existing condition is:

```tsx
{type === "text" || type === "text-question" || type === "long-text-question" || type === "upload-file" || type === "sketch-render" ? (
```

Add `display-section` to it:

```tsx
{type === "text" || type === "text-question" || type === "long-text-question" || type === "upload-file" || type === "sketch-render" || type === "display-section" ? (
  <div className="space-y-2">
    <Label>
      {type === "upload-file"
        ? "Instructions for pupils"
        : type === "display-section"
        ? "Section description"
        : "Instructions"}
    </Label>
    <RichTextEditor
      id="activity-text"
      value={text}
      onChange={setText}
      placeholder={
        type === "upload-file"
          ? "Explain what pupils should upload"
          : type === "display-section"
          ? "Describe what this section covers"
          : "Enter the activity instructions"
      }
      disabled={isPending}
    />
  </div>
) : null}
```

- [ ] **Step 6: Pass `sectionIndex` to the preview renderer inside the manager**

Locate `renderActivityPreview` at line 1686-1710 and change its signature to accept and forward `sectionIndex`:

```ts
function renderActivityPreview(
  activity: LessonActivity,
  resolvedImageUrl: string | null,
  options?: {
    onSummativeChange?: (nextValue: boolean) => void
    summativeUpdating?: boolean
    summativeDisabled?: boolean
    onImageClick?: (url: string, title: string | null) => void
    onDownloadFile?: () => void
    sectionIndex?: number
  },
) {
  return (
    <LessonActivityView
      mode="short"
      activity={activity}
      lessonId={activity.lesson_id ?? ""}
      resolvedImageUrl={resolvedImageUrl ?? null}
      onSummativeChange={options?.onSummativeChange}
      summativeUpdating={options?.summativeUpdating}
      summativeDisabled={options?.summativeDisabled}
      onImageClick={options?.onImageClick}
      onDownloadFile={options?.onDownloadFile}
      sectionIndex={options?.sectionIndex}
    />
  )
}
```

- [ ] **Step 7: Compute the section index map at the manager level and pass it to each preview**

Import `computeSectionIndexMap` at the top of `src/components/lessons/lesson-activities-manager.tsx`:

```ts
import { computeSectionIndexMap } from "@/components/lessons/activity-view/utils"
```

The activities list variable in this file is `activities` (the one being iterated at line 1262 as `activities.map((activity) => { ... })`). Add a memo right before that `.map(...)` block (or alongside the other component-level memos such as `typeLabelMap` at line 236):

```ts
const sectionIndexMap = useMemo(
  () => computeSectionIndexMap(activities),
  [activities],
)
```

Then edit the `renderActivityPreview` call at line 1286 to pass `sectionIndex` via the options bag:

```ts
const preview = renderActivityPreview(activity, imageThumbnail, {
  onSummativeChange: (checked) => toggleSummative(activity, checked),
  summativeUpdating,
  summativeDisabled,
  onImageClick: (url, title) => openImageModal(url, title ?? activity.title ?? "Activity image"),
  onDownloadFile: canDownloadFiles ? () => handleFileDownload(activity) : undefined,
  sectionIndex: sectionIndexMap.get(activity.activity_id),
})
```

This is the only call site for `renderActivityPreview` — verified via `grep -n "renderActivityPreview(" src/components/lessons/lesson-activities-manager.tsx` (one invocation at line 1286, one definition at line 1686).

- [ ] **Step 8: Verify type-check passes**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/components/lessons/lesson-activities-manager.tsx
git commit -m "feat(activities): add display-section editor + preview wiring"
```

---

## Task 7: Pass `sectionIndex` from the activities overview page

**Files:**
- Modify: `src/app/lessons/[lessonId]/activities/page.tsx:155-189`

- [ ] **Step 1: Import `computeSectionIndexMap`**

Add to the import block near the top of the file:

```ts
import { computeSectionIndexMap } from "@/components/lessons/activity-view/utils"
```

- [ ] **Step 2: Compute the map before rendering the list**

The page renders a pair list `activitiesWithPreview` (line 154) over an `orderedActivities` variable (referenced at lines 144, 148). Just before the `.map(...)` at line 154 (outside the JSX, somewhere in the server-component function body where `orderedActivities` is in scope), compute:

```ts
const sectionIndexMap = computeSectionIndexMap(orderedActivities)
```

- [ ] **Step 3: Pass `sectionIndex` into `LessonActivityView`**

Edit the JSX at line 171-176:

```tsx
<LessonActivityView
  mode="short"
  activity={activity}
  lessonId={lesson.lesson_id}
  resolvedImageUrl={imageUrl}
  sectionIndex={sectionIndexMap.get(activity.activity_id)}
/>
```

- [ ] **Step 4: Verify type-check passes**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/lessons/[lessonId]/activities/page.tsx
git commit -m "feat(activities): pass sectionIndex on activities overview page"
```

---

## Task 8: Pass `sectionIndex` from the lesson sidebar presentation callers

**Files:**
- Modify: `src/components/units/lesson-sidebar.tsx` (two `mode="present"` call sites at lines 2514 and 2631)

- [ ] **Step 1: Import `computeSectionIndexMap`**

Add to the file's imports:

```ts
import { computeSectionIndexMap } from "@/components/lessons/activity-view/utils"
```

- [ ] **Step 2: Build the section index map from the activity list**

The file holds its activities in state as `const [activities, setActivities] = useState<LessonActivity[]>([])` at line 252. Alongside the other component-level memos in the same component, add:

```ts
const sectionIndexMap = useMemo(
  () => computeSectionIndexMap(activities),
  [activities],
)
```

If the present-mode call sites at lines 2514 and 2631 are inside nested render helpers or child components where `activities` is not directly in scope, either (a) lift the memo up to a common ancestor, or (b) pass `sectionIndexMap` down via props. Prefer (a) if both call sites share a parent that already has `activities` in scope.

- [ ] **Step 3: Pass `sectionIndex` into both `mode="present"` call sites**

At line 2514 and line 2631, add the prop:

```tsx
<LessonActivityView
  mode="present"
  // ...existing props...
  sectionIndex={sectionIndexMap.get(activity.activity_id)}
/>
```

Note: check that `pupil-feedback-activity.tsx` line 93 does **not** need updating — it renders a single activity in isolation without a sibling list, so `sectionIndex` is not meaningful there and the prop is optional. Leave it unchanged.

- [ ] **Step 4: Verify type-check passes**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/units/lesson-sidebar.tsx
git commit -m "feat(activities): pass sectionIndex in lesson sidebar present views"
```

---

## Task 9: Manual verification in the dev server

**Files:**
- None (verification only)

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
Expected: server starts on http://localhost:3000.

- [ ] **Step 2: Create a `Display Section` activity**

In a browser, log in as a teacher, navigate to a lesson's activities page, click to add a new activity, choose "Display Section" from the type dropdown. Enter a title ("Warm-up") and a description ("Let's start with a quick recap."). Save.

Expected: activity is saved; appears in the activity list as a distinct bordered header card showing "Section 1: Warm-up" and the description rendered as prose.

- [ ] **Step 3: Add a second section further down the list**

Create another `display-section` activity with title "Main task". It should appear below other activities.

Expected: the second card shows "Section 2: Main task" (index auto-incremented).

- [ ] **Step 4: Reorder so the second section moves above the first**

Drag/reorder (using the existing activity reordering UI) the "Main task" section above "Warm-up".

Expected: indices update on refresh (or immediately if reorder mutates the cached list): "Main task" now shows "Section 1", "Warm-up" shows "Section 2".

- [ ] **Step 5: Present the lesson**

From the lesson page, enter presentation mode (whichever UI path triggers `mode="present"` in `lesson-sidebar.tsx`). Navigate to one of the display-section activities.

Expected: full-screen layout showing "Section N" label, large title, and description rendered with prose styling.

- [ ] **Step 6: Edit the description of an existing section**

Open the edit form for a display-section activity. The rich-text editor should be prefilled with the saved description. Change the description and save.

Expected: saved successfully; updated text appears in both short and presentation views.

- [ ] **Step 7: Attempt to mark a display-section as summative**

In the activity list, verify that the Assessment (summative) toggle is **not** available for a display-section activity — the non-scorable type guard should hide/disable it.

Expected: no Assessment toggle shown for display-section activities. Confirms that `is_summative` can't be set on this type.

- [ ] **Step 8: Stop the dev server**

Stop the dev server (Ctrl+C).

- [ ] **Step 9: Run lint**

Run: `pnpm lint`
Expected: no new lint errors introduced by the feature (pre-existing warnings may remain, but the new files/changes must be clean).

---

## Self-review checklist

- [ ] Spec section "Data model" covered by Task 1, 2.
- [ ] Spec section "Server behaviour" covered by Task 2.
- [ ] Spec section "Editor UI" covered by Task 6.
- [ ] Spec section "Index computation" covered by Task 3 and index-map plumbing in Tasks 6–8.
- [ ] Spec section "Rendering" covered by Tasks 4 and 5.
- [ ] Spec section "Error / edge cases" verified in Task 9 manual checks (empty description, reorder, no-section list, summative-toggle guard).
- [ ] Spec "Testing" guidance matched (Playwright infrastructure exists but no new spec added — matches spec's "manual verification" guidance; a future E2E can be added if desired).
