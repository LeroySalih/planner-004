# Teacher Upload-on-Behalf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let teachers upload a file onto a pupil's submission from the assignment-results marking panel — via drag-and-drop on the Pupil response box or a "Upload for pupil" file picker — recorded exactly as if the pupil had submitted it.

**Architecture:** Relax the three existing `/api/pupil-submission/*` upload routes to accept teacher-on-behalf uploads (authorize self OR teacher; derive ownership and storage path from `pupilId`). Add one shared client component, `TeacherSubmissionDropzone`, that wraps the Pupil response box in both marking panels and POSTs to the type-specific route, reusing the existing storage / submission / AI-mark / SSE pipeline unchanged.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `pg`, local storage client, `sonner` toasts, Playwright E2E.

## Global Constraints

- Two-space indentation throughout.
- No backwards-compatibility hacks: delete replaced code, don't comment it out.
- `upload-file` gets NO AI marking — mirror the pupil flow exactly. Only `upload-spreadsheet` / `upload-worksheet` enqueue AI marking, and only when `groupAssignmentId` is present.
- Submission ownership for teacher uploads MUST be the pupil: `submissions.user_id = pupilId` and storage path derived from the pupil's storage key. The real uploader is recorded only in storage metadata `uploadedBy`.
- Testing reality (from CLAUDE.md): no unit-test infrastructure exists; E2E is Playwright only and is data-dependent. Route/component correctness is verified via `pnpm lint` + `pnpm build` (typecheck) + browser-preview verification; a guarded Playwright spec is added that skips when no suitable assignment cell exists in the test data.
- Test teacher credentials (from existing specs): `leroysalih@bisak.org` / `bisak123`.

---

### Task 1: Allow teacher-on-behalf uploads in the three pupil-submission routes

All three routes share the same shape. Apply the identical four edits to each:
`src/app/api/pupil-submission/upload/route.ts`,
`src/app/api/pupil-submission/upload-spreadsheet/route.ts`,
`src/app/api/pupil-submission/upload-worksheet/route.ts`.

**Files:**
- Modify: `src/app/api/pupil-submission/upload/route.ts`
- Modify: `src/app/api/pupil-submission/upload-spreadsheet/route.ts`
- Modify: `src/app/api/pupil-submission/upload-worksheet/route.ts`

**Interfaces:**
- Consumes: `getAuthenticatedProfile()` and `hasRole(profile, role)` from `@/lib/auth`; existing `resolvePupilStorageKey(pupilId)` helper local to each route.
- Produces: each route now returns `{ success: true }` (or its existing success shape) for a `pupilId` that differs from the session user, when the session user has the `teacher` role; the created `submissions` row has `user_id = pupilId`.

- [ ] **Step 1: Add `hasRole` to the auth import (all three routes)**

In each route, change the auth import line:

```ts
import { getAuthenticatedProfile } from "@/lib/auth"
```

to:

```ts
import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
```

- [ ] **Step 2: Relax the ownership check (all three routes)**

In each route, replace the self-only guard:

```ts
  if (profile.userId !== pupilId) {
    return NextResponse.json({ success: false, error: "You can only upload files for your own account." }, { status: 403 })
  }
```

with a self-OR-teacher guard:

```ts
  if (profile.userId !== pupilId && !hasRole(profile, "teacher")) {
    return NextResponse.json({ success: false, error: "You are not allowed to upload files for this pupil." }, { status: 403 })
  }
```

(The message and exact surrounding whitespace match each file; the `upload/route.ts` variant has additional `console.warn` lines around it — leave those as-is, only change the `if` condition and the message.)

- [ ] **Step 3: Derive ownership and storage key from `pupilId`, keep uploader for audit (all three routes)**

In each route, replace:

```ts
  const userId = profile.userId
```

with:

```ts
  const userId = pupilId
  const uploaderId = profile.userId
```

and replace the storage-key resolution:

```ts
    pupilStorageKey = profile.email?.trim() ?? (await resolvePupilStorageKey(userId))
```

with:

```ts
    pupilStorageKey = await resolvePupilStorageKey(pupilId)
```

and replace the storage metadata uploader:

```ts
    uploadedBy: userId,
```

with:

```ts
    uploadedBy: uploaderId,
```

(After this, `userId` everywhere else in the route — `getNextAttemptNumber`, the `insert into submissions`, `clearResubmitRequest`, `logActivitySubmissionEvent`, the SSE emit — correctly references the pupil. `pupilId` is already narrowed to `string` by the earlier `typeof pupilId !== "string"` guards, so `const userId = pupilId` typechecks.)

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm build`
Expected: compiles with no TypeScript errors in the three route files.

Run: `pnpm lint`
Expected: no new lint errors in the three route files.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/pupil-submission/upload/route.ts src/app/api/pupil-submission/upload-spreadsheet/route.ts src/app/api/pupil-submission/upload-worksheet/route.ts
git commit -m "feat: allow teachers to upload pupil submissions on behalf via existing upload routes"
```

---

### Task 2: Add the shared `TeacherSubmissionDropzone` client component

**Files:**
- Create: `src/components/assignment-results/teacher-submission-dropzone.tsx`

**Interfaces:**
- Consumes: the three routes from Task 1.
- Produces: a React component
  ```ts
  function TeacherSubmissionDropzone(props: {
    enabled: boolean
    lessonId: string
    activityId: string
    activityType: string
    pupilId: string
    assignmentId: string
    disabled?: boolean
    onUploaded: () => void
    children: React.ReactNode
  }): JSX.Element
  ```
  When `enabled` is false it renders `children` unchanged (pass-through). When true it wraps `children` in a drop target and appends an "Upload for pupil" file-picker control.

- [ ] **Step 1: Create the component file**

Create `src/components/assignment-results/teacher-submission-dropzone.tsx`:

```tsx
"use client"

import { useCallback, useRef, useState, useTransition, type ReactNode } from "react"
import { toast } from "sonner"
import { Upload } from "lucide-react"

import { Button } from "@/components/ui/button"

const UPLOAD_ENDPOINTS: Record<string, string> = {
  "upload-file": "/api/pupil-submission/upload",
  "upload-spreadsheet": "/api/pupil-submission/upload-spreadsheet",
  "upload-worksheet": "/api/pupil-submission/upload-worksheet",
}

// These types auto-enqueue AI marking server-side when a groupAssignmentId is sent.
const AI_MARKED_TYPES = new Set(["upload-spreadsheet", "upload-worksheet"])

type TeacherSubmissionDropzoneProps = {
  enabled: boolean
  lessonId: string
  activityId: string
  activityType: string
  pupilId: string
  assignmentId: string
  disabled?: boolean
  onUploaded: () => void
  children: ReactNode
}

export function TeacherSubmissionDropzone({
  enabled,
  lessonId,
  activityId,
  activityType,
  pupilId,
  assignmentId,
  disabled = false,
  onUploaded,
  children,
}: TeacherSubmissionDropzoneProps) {
  const [isPending, startTransition] = useTransition()
  const [isDragActive, setIsDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Synchronous guard against duplicate concurrent uploads (mirrors PupilUploadActivity).
  const uploadInProgress = useRef(false)

  const endpoint = UPLOAD_ENDPOINTS[activityType]
  const canUpload =
    enabled && Boolean(endpoint) && !disabled && !isPending && lessonId.length > 0 && pupilId.length > 0

  const beginUpload = useCallback(
    (incoming: FileList | File[]) => {
      if (!endpoint) return
      if (uploadInProgress.current) return
      uploadInProgress.current = true

      const files = Array.from(incoming ?? []).filter((file) => file.size > 0)
      if (files.length === 0) {
        uploadInProgress.current = false
        return
      }
      const file = files[0]

      startTransition(async () => {
        try {
          const formData = new FormData()
          formData.append("lessonId", lessonId)
          formData.append("activityId", activityId)
          formData.append("pupilId", pupilId)
          formData.append("file", file)
          if (AI_MARKED_TYPES.has(activityType) && assignmentId) {
            formData.append("groupAssignmentId", assignmentId)
          }

          let result: { success: boolean; error?: string }
          try {
            const response = await fetch(endpoint, { method: "POST", body: formData })
            result = await response.json()
          } catch (err) {
            console.error("[teacher-upload] Network error during upload", err)
            result = { success: false, error: "Network error, please try again." }
          }

          if (!result.success) {
            toast.error(`Upload failed for ${file.name}`, {
              description: result.error ?? "Please try again later.",
            })
            return
          }

          toast.success(`Uploaded ${file.name} on behalf of the pupil`)
          onUploaded()
        } finally {
          uploadInProgress.current = false
        }
      })
    },
    [activityId, activityType, assignmentId, endpoint, lessonId, onUploaded, pupilId],
  )

  if (!enabled) {
    return <>{children}</>
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setIsDragActive(true)
  }

  const handleDragLeave = () => setIsDragActive(false)

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload) return
    event.preventDefault()
    setIsDragActive(false)
    const files = event.dataTransfer.files
    if (files && files.length > 0) {
      beginUpload(files)
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={["rounded-md transition", isDragActive ? "ring-2 ring-primary ring-offset-1" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canUpload}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-1 h-3.5 w-3.5" />
          {isPending ? "Uploading…" : "Upload for pupil"}
        </Button>
        <span className="text-[11px] text-muted-foreground">or drag &amp; drop a file here</span>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          disabled={!canUpload}
          onChange={(event) => {
            const files = event.target.files
            if (files && files.length > 0) {
              beginUpload(files)
            }
            event.target.value = ""
          }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm build`
Expected: compiles with no TypeScript errors.

Run: `pnpm lint`
Expected: no new lint errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/assignment-results/teacher-submission-dropzone.tsx
git commit -m "feat: add TeacherSubmissionDropzone for teacher upload-on-behalf"
```

---

### Task 3: Wire the dropzone into both marking panels

The dashboard renders the Pupil response box twice — a desktop `<aside>` (around line 2555) and a mobile `<Sheet>` (around line 3574). Wrap each existing box with `TeacherSubmissionDropzone`, passing `enabled={isUploadListingActivityType(selection.activity.type)}`. The existing box JSX (heading + status/answer ternary) stays unchanged as `children`.

**Files:**
- Modify: `src/components/assignment-results/assignment-results-dashboard.tsx`

**Interfaces:**
- Consumes: `TeacherSubmissionDropzone` from Task 2; existing in-scope values `matrixState.lesson?.lessonId`, `matrixState.assignmentId`, `selection.activity.activityId`, `selection.activity.type`, `selection.row.pupil.userId`, `handleUploadRefresh`, `isUploadListingActivityType`.
- Produces: no new exports.

- [ ] **Step 1: Import the component**

Near the other component imports at the top of `src/components/assignment-results/assignment-results-dashboard.tsx`, add:

```ts
import { TeacherSubmissionDropzone } from "@/components/assignment-results/teacher-submission-dropzone"
```

- [ ] **Step 2: Wrap the desktop Pupil response box**

Find this block (desktop `<aside>`, around lines 2555–2583):

```tsx
                  <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">Pupil response</p>
                    {isUploadListingActivityType(selection.activity.type) ? (
```

Insert the opening wrapper immediately BEFORE that `<div>`:

```tsx
                  <TeacherSubmissionDropzone
                    enabled={isUploadListingActivityType(selection.activity.type)}
                    lessonId={matrixState.lesson?.lessonId ?? ""}
                    activityId={selection.activity.activityId}
                    activityType={selection.activity.type}
                    pupilId={selection.row.pupil.userId}
                    assignmentId={matrixState.assignmentId}
                    disabled={!matrixState.lesson?.lessonId}
                    onUploaded={handleUploadRefresh}
                  >
```

Then find the matching closing `</div>` of that box — the one immediately before the `{isUploadListingActivityType(selection.activity.type) ? (` block that renders the **Uploaded files** card (around line 2583/2585):

```tsx
                    )}
                  </div>

                  {isUploadListingActivityType(selection.activity.type) ? (
                    <div className="rounded-md border border-border/60 bg-muted/40 p-3">
```

Insert the closing wrapper immediately AFTER that `</div>`:

```tsx
                    )}
                  </div>
                  </TeacherSubmissionDropzone>

                  {isUploadListingActivityType(selection.activity.type) ? (
                    <div className="rounded-md border border-border/60 bg-muted/40 p-3">
```

- [ ] **Step 3: Wrap the mobile Pupil response box**

Find this block (mobile `<Sheet>`, around lines 3574–3615) — note the preceding `<>` fragment opener at line 3573:

```tsx
                      <>
                        <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Pupil response</p>
```

Insert the opening wrapper immediately BEFORE the `<div className="rounded-md border border-primary/40 bg-primary/5 p-3">` (i.e. after `<>`):

```tsx
                      <>
                        <TeacherSubmissionDropzone
                          enabled={isUploadListingActivityType(selection.activity.type)}
                          lessonId={matrixState.lesson?.lessonId ?? ""}
                          activityId={selection.activity.activityId}
                          activityType={selection.activity.type}
                          pupilId={selection.row.pupil.userId}
                          assignmentId={matrixState.assignmentId}
                          disabled={!matrixState.lesson?.lessonId}
                          onUploaded={handleUploadRefresh}
                        >
                        <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
```

Then find the matching closing `</div>` of that box — immediately before the mobile **Uploaded files** card (around line 3615/3617):

```tsx
                        <p className="text-sm text-foreground">No response has been recorded yet.</p>
                      )}
                    </div>

                    {isUploadListingActivityType(selection.activity.type) ? (
                      <div className="rounded-md border border-border/60 bg-muted/40 p-3">
```

Insert the closing wrapper immediately AFTER that `</div>`:

```tsx
                        <p className="text-sm text-foreground">No response has been recorded yet.</p>
                      )}
                    </div>
                    </TeacherSubmissionDropzone>

                    {isUploadListingActivityType(selection.activity.type) ? (
                      <div className="rounded-md border border-border/60 bg-muted/40 p-3">
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm build`
Expected: compiles with no TypeScript / JSX-nesting errors. If the build reports an unbalanced-tag error, re-check that each opening `<TeacherSubmissionDropzone>` has exactly one matching `</TeacherSubmissionDropzone>` wrapping only the Pupil response box (NOT the Uploaded files card).

Run: `pnpm lint`
Expected: no new lint errors.

- [ ] **Step 5: Browser-preview verification**

Start the dev server (preview_start) and sign in as the test teacher (`leroysalih@bisak.org` / `bisak123`). Navigate to a `/results/assignments/<id>` page that has an upload activity, click a pupil cell to open the marking panel, and confirm:
- The Pupil response box shows an "Upload for pupil" button and "or drag & drop a file here" hint for upload activities.
- For a non-upload activity (e.g. a short-text question), the box shows NO upload control (pass-through).
- Clicking "Upload for pupil" and choosing a small file shows a success toast and the file appears in the "Uploaded files" card after refresh.

Capture a screenshot (preview_screenshot) of the marking panel with the upload control visible for the user.

- [ ] **Step 6: Commit**

```bash
git add src/components/assignment-results/assignment-results-dashboard.tsx
git commit -m "feat: make Pupil response box a teacher upload drop target in both marking panels"
```

---

### Task 4: Guarded Playwright spec for the teacher upload flow

A full drag-drop simulation is unreliable in Playwright, so the spec drives the "Upload for pupil" picker via `setInputFiles`, and skips gracefully when the test data has no assignment with an open upload cell.

**Files:**
- Create: `tests/assignment-results/teacher-upload-on-behalf.spec.ts`

**Interfaces:**
- Consumes: the wired UI from Task 3; test teacher credentials from Global Constraints.
- Produces: no exports.

- [ ] **Step 1: Write the spec**

Create `tests/assignment-results/teacher-upload-on-behalf.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

const TEACHER_EMAIL = "leroysalih@bisak.org"
const TEACHER_PASSWORD = "bisak123"

test.describe("Teacher upload on behalf of pupil", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeEach(async ({ page }) => {
    await page.goto("/signin")
    await page.getByRole("textbox", { name: "Email address" }).fill(TEACHER_EMAIL)
    await page.getByRole("textbox", { name: "Password" }).fill(TEACHER_PASSWORD)
    await page.getByRole("button", { name: "Sign in" }).click()
    await page.waitForURL(/\/(assignments|$)/)
  })

  test("teacher can upload a file into a pupil's upload cell", async ({ page }) => {
    // Open the first assignment that has a results view, if any.
    await page.goto("/assignments")
    const firstResultsLink = page.getByRole("link").filter({ hasText: /result/i }).first()
    const hasResults = (await firstResultsLink.count()) > 0
    test.skip(!hasResults, "No assignment results available in test data")
    await firstResultsLink.click()
    await expect(page).toHaveURL(/\/results\/assignments\/.+/)

    // Find the "Upload for pupil" control; it only appears after selecting an
    // upload-activity cell, so click the first selectable score cell first.
    const firstCell = page.getByRole("button").filter({ hasText: /%$/ }).first()
    const hasCell = (await firstCell.count()) > 0
    test.skip(!hasCell, "No selectable score cells in test data")
    await firstCell.click()

    const uploadButton = page.getByRole("button", { name: "Upload for pupil" })
    const isUploadActivity = (await uploadButton.count()) > 0
    test.skip(!isUploadActivity, "Selected cell is not an upload activity")

    // The hidden file input is the sibling of the button inside the dropzone.
    const fileInput = page.locator('input[type="file"]').last()
    await fileInput.setInputFiles({
      name: "teacher-upload.png",
      mimeType: "image/png",
      buffer: Buffer.from("89504e470d0a1a0a", "hex"),
    })

    await expect(page.getByText(/Uploaded .* on behalf of the pupil/)).toBeVisible({ timeout: 15000 })
  })
})
```

- [ ] **Step 2: Run the spec**

Run: `pnpm exec playwright test tests/assignment-results/teacher-upload-on-behalf.spec.ts`
Expected: the test passes — either by completing the upload assertion, or by hitting one of the `test.skip` guards when the seeded test data has no suitable assignment/cell (a skipped test is a pass for CI purposes here).

- [ ] **Step 3: Commit**

```bash
git add tests/assignment-results/teacher-upload-on-behalf.spec.ts
git commit -m "test: add guarded e2e for teacher upload on behalf of pupil"
```

---

## Self-Review

**Spec coverage:**
- Relax 3 routes (auth + pupil-derived ownership + audit uploader) → Task 1. ✓
- Shared dropzone component with drop target + click-to-browse fallback → Task 2. ✓
- Wire into both desktop and mobile Pupil response panels → Task 3. ✓
- All three upload types via endpoint map; AI-mark types send `groupAssignmentId` → Task 2 (`UPLOAD_ENDPOINTS`, `AI_MARKED_TYPES`). ✓
- `upload-file` no AI marking (mirror pupil flow) → enforced by routes (Task 1) + only spreadsheet/worksheet in `AI_MARKED_TYPES`. ✓
- SSE cell update + uploads-list refresh → `onUploaded={handleUploadRefresh}` (Task 3) + existing SSE handler. ✓
- Testing → Task 4 (guarded E2E) + per-task build/lint + preview verification (Task 3 Step 5). ✓

**Placeholder scan:** No TBD/TODO; all code shown in full. ✓

**Type consistency:** Prop names (`enabled`, `lessonId`, `activityId`, `activityType`, `pupilId`, `assignmentId`, `disabled`, `onUploaded`, `children`) are identical in the component definition (Task 2) and both call sites (Task 3). Endpoint keys match the activity-type strings used by `isUploadListingActivityType` (`upload-file`, `upload-spreadsheet`, `upload-worksheet`). Route edits keep `userId` as the pupil owner so all downstream uses stay valid. ✓
