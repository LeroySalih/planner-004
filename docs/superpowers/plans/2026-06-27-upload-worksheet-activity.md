# Upload Worksheet Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `upload-worksheet` lesson activity type that lets pupils photograph a completed paper worksheet, stores the photo, and sends it to the existing n8n AI marking flow embedded as a `WORKSHEET_IMAGE` base64 field — mirroring the existing `upload-spreadsheet` activity type end-to-end.

**Architecture:** Copy the `upload-spreadsheet` pattern at every layer (Zod schema, local-disk file storage, pupil upload UI, AI marking queue, webhook callback, teacher authoring UI, activity preview, assignment results dashboard), swapping `.xlsx`-specific validation/parsing for image validation and base64 embedding. No new database tables, no new env vars, no new n8n webhook — same `submissions` table, same `N8N_MARKING_WEBHOOK_URL`, same `/webhooks/ai-mark` callback.

**Tech Stack:** Next.js 15 App Router, TypeScript, Zod, PostgreSQL via `pg`, local disk storage client, React 19 client components, Tailwind, sonner toasts.

## Global Constraints

- Two-space indentation throughout (per CLAUDE.md).
- Server actions / API routes validate with Zod and return `{ data, error }` or `{ success, error }` shapes consistent with existing routes — do not invent new response shapes.
- No backwards-compatibility hacks; this is new code, not a migration.
- File formats: `image/jpeg`, `image/png`, `image/heic`/`image/heif` (and `.heic`/`.heif` extensions), max 10MB, single file per submission (re-upload replaces, no versioning) — matches the approved design.
- AI marking payload field name for the image is exactly `WORKSHEET_IMAGE` (user-specified, case-sensitive).
- Reuses `N8N_MARKING_WEBHOOK_URL` / `N8N_MARKING_AUTH` / `AI_MARKING_CALLBACK_URL` / `MARK_SERVICE_KEY` env vars — no new env vars.
- No unit test infrastructure in this repo; verification is `pnpm lint`, `pnpm exec tsc --noEmit` (or `pnpm build`), and a manual walkthrough in the dev server.

---

### Task 1: Schemas and activity-type config

**Files:**
- Modify: `src/types/index.ts` (insert after `UploadSpreadsheetSubmissionBody` type export, currently ending at line ~593)
- Modify: `src/dino.config.ts:8` (`SCORABLE_ACTIVITY_TYPES` array)

**Interfaces:**
- Produces: `UploadWorksheetActivityBodySchema`, `UploadWorksheetActivityBody`, `UploadWorksheetSubmissionBodySchema`, `UploadWorksheetSubmissionBody` — consumed by Tasks 2, 3, 5, 6, 7, 8, 9.

- [ ] **Step 1: Add the schemas**

In `src/types/index.ts`, immediately after the existing block:

```typescript
export type UploadSpreadsheetSubmissionBody = z.infer<
    typeof UploadSpreadsheetSubmissionBodySchema
>;
```

add:

```typescript
export const UploadWorksheetActivityBodySchema = z
    .object({
        task: z.string().min(1),
        markingGuidance: z.string().min(1),
    })
    .passthrough();

export const UploadWorksheetSubmissionBodySchema = z
    .object({
        filePath: z.string().min(1),
        fileName: z.string().min(1),
        ai_model_score: z.number().min(0).max(1).nullable().optional(),
        ai_model_feedback: z.string().nullable().optional(),
        teacher_override_score: z.number().min(0).max(1).nullable().optional(),
        is_correct: z.boolean().default(false),
        teacher_feedback: z.string().nullable().optional(),
        success_criteria_scores: z
            .record(z.string(), z.number().min(0).max(1).nullable())
            .default({}),
    })
    .passthrough();

export type UploadWorksheetActivityBody = z.infer<
    typeof UploadWorksheetActivityBodySchema
>;
export type UploadWorksheetSubmissionBody = z.infer<
    typeof UploadWorksheetSubmissionBodySchema
>;
```

- [ ] **Step 2: Register the activity type as scorable**

In `src/dino.config.ts`, change:

```typescript
export const SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "multiple-choice-question",
  "short-text-question",
  "text-question",
  "long-text-question",
  "upload-file",
  "upload-url",
  "upload-spreadsheet",
  "feedback",
  "sketch-render",
  "do-flashcards",
  "matcher",
  "group-items",
]);
```

to:

```typescript
export const SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "multiple-choice-question",
  "short-text-question",
  "text-question",
  "long-text-question",
  "upload-file",
  "upload-url",
  "upload-spreadsheet",
  "upload-worksheet",
  "feedback",
  "sketch-render",
  "do-flashcards",
  "matcher",
  "group-items",
]);
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors (existing unrelated errors, if any, are out of scope).

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/dino.config.ts
git commit -m "feat: add upload-worksheet activity schemas and register as scorable"
```

---

### Task 2: Pupil upload API route

**Files:**
- Create: `src/app/api/pupil-submission/upload-worksheet/route.ts`

**Interfaces:**
- Consumes: `UploadWorksheetSubmissionBodySchema` from Task 1; `createLocalStorageClient` from `@/lib/storage/local-storage`; `enqueueMarkingTasks`, `triggerQueueProcessor` from `@/lib/ai/marking-queue`; `getAuthenticatedProfile` from `@/lib/auth`; `query` from `@/lib/db`; `emitSubmissionEvent` from `@/lib/sse/topics`; `logActivitySubmissionEvent` from `@/lib/activity-logging`.
- Produces: `POST /api/pupil-submission/upload-worksheet` accepting `FormData{ lessonId, activityId, pupilId, file, groupAssignmentId? }`, returns `{ success: boolean, submissionId?: string, error?: string }` — consumed by Task 3.

- [ ] **Step 1: Create the route file**

Copy `src/app/api/pupil-submission/upload-spreadsheet/route.ts` verbatim to the new path, then apply these changes:

```typescript
import { NextResponse } from "next/server"
import { Client } from "pg"

import { getAuthenticatedProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { logActivitySubmissionEvent } from "@/lib/activity-logging"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import { UploadWorksheetSubmissionBodySchema } from "@/types"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic", ".heif"]
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  // Some browsers/OSes send this generic type instead of a specific image type.
  "application/octet-stream",
])

function buildSubmissionPath(lessonId: string, activityId: string, pupilStorageKey: string, fileName: string) {
  return `lessons/${lessonId}/activities/${activityId}/${pupilStorageKey}/${fileName}`
}

function createPgClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured")
  }
  return new Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  })
}

async function resolvePupilStorageKey(pupilId: string): Promise<string> {
  const { rows } = await query<{ email: string | null }>(
    `select email from profiles where user_id = $1 limit 1`,
    [pupilId],
  )
  const email = rows?.[0]?.email?.trim()
  return email && email.length > 0 ? email : pupilId
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[pupil-upload-worksheet:${requestId}]`

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error(`${tag} Failed to parse form data`, err)
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 })
  }

  const lessonId = formData.get("lessonId")
  const activityId = formData.get("activityId")
  const pupilId = formData.get("pupilId")
  const groupAssignmentIdRaw = formData.get("groupAssignmentId")
  const groupAssignmentId = typeof groupAssignmentIdRaw === "string" && groupAssignmentIdRaw.trim() !== "" ? groupAssignmentIdRaw : null
  const file = formData.get("file")

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing lessonId" }, { status: 400 })
  }
  if (typeof activityId !== "string" || activityId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing activityId" }, { status: 400 })
  }
  if (typeof pupilId !== "string" || pupilId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing pupilId" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }

  if (profile.userId !== pupilId) {
    return NextResponse.json({ success: false, error: "You can only upload files for your own account." }, { status: 403 })
  }

  const fileName = file.name
  const lowerName = fileName.toLowerCase()
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
  const hasAllowedMime = file.type === "" || ALLOWED_MIME_TYPES.has(file.type)
  if (!hasAllowedExtension || !hasAllowedMime) {
    return NextResponse.json({ success: false, error: "Only JPEG, PNG, or HEIC photos are allowed" }, { status: 415 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ success: false, error: "File exceeds 10MB limit" }, { status: 413 })
  }

  const userId = profile.userId

  let pupilStorageKey: string
  try {
    pupilStorageKey = profile.email?.trim() ?? (await resolvePupilStorageKey(userId))
  } catch (err) {
    console.error(`${tag} Failed to resolve pupil storage key`, err)
    return NextResponse.json({ success: false, error: "Unable to process upload." }, { status: 500 })
  }

  const path = buildSubmissionPath(lessonId, activityId, pupilStorageKey, fileName)
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)

  let arrayBuffer: ArrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
  } catch (err) {
    console.error(`${tag} Failed to read file buffer`, err)
    return NextResponse.json({ success: false, error: "Failed to read file." }, { status: 500 })
  }

  // Always write to the same path (no versioning) so a re-upload simply replaces the file.
  const { error: uploadError } = await storage.upload(path, arrayBuffer, {
    contentType: file.type || "image/jpeg",
    uploadedBy: userId,
    originalPath: path,
  })

  if (uploadError) {
    console.error(`${tag} Storage upload failed`, { path, error: uploadError.message })
    return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
  }

  const submittedAt = new Date().toISOString()
  let submissionId: string | null = null
  const client = createPgClient()

  try {
    await client.connect()

    try {
      const { rows: existingRows } = await client.query(
        `
          select submission_id
          from submissions
          where activity_id = $1 and user_id = $2
          order by submitted_at desc
          limit 1
        `,
        [activityId, userId],
      )
      const existing = existingRows[0]

      const submissionBody = UploadWorksheetSubmissionBodySchema.parse({
        filePath: path,
        fileName,
        ai_model_score: null,
        ai_model_feedback: null,
        is_correct: false,
        success_criteria_scores: {},
      })

      if (existing?.submission_id) {
        await client.query(
          `
            update submissions
            set body = $1, submitted_at = $2, submission_status = 'submitted', is_flagged = false, resubmit_requested = false, resubmit_note = NULL
            where submission_id = $3
          `,
          [submissionBody, submittedAt, existing.submission_id],
        )
        submissionId = existing.submission_id
      } else {
        const { rows: newRows } = await client.query(
          `
            insert into submissions (activity_id, user_id, body, submitted_at, submission_status)
            values ($1, $2, $3, $4, 'submitted')
            returning submission_id
          `,
          [activityId, userId, submissionBody, submittedAt],
        )
        submissionId = newRows[0]?.submission_id ?? null
      }

      await logActivitySubmissionEvent({ submissionId, activityId, lessonId, pupilId: userId, fileName, submittedAt })
    } catch (err) {
      console.error(`${tag} DB upsert failed — rolling back storage`, { path, error: err })
      await storage.remove([path])
      return NextResponse.json({ success: false, error: "Unable to record submission." }, { status: 500 })
    }
  } finally {
    try {
      await client.end()
    } catch {
      // ignore
    }
  }

  try {
    emitSubmissionEvent("submission.uploaded", {
      submissionId,
      activityId,
      pupilId: userId,
      submittedAt,
      fileName,
      submissionStatus: "submitted",
      isFlagged: false,
    })
  } catch (err) {
    console.error(`${tag} SSE emit failed (non-fatal)`, err)
  }

  // Auto-trigger AI marking on every submit/re-submit — no debounce, since
  // each call here represents a complete file replace, not a keystroke.
  if (submissionId && groupAssignmentId) {
    try {
      await enqueueMarkingTasks(groupAssignmentId, [{ submissionId }])
      await triggerQueueProcessor()
    } catch (err) {
      console.error(`${tag} Failed to enqueue AI marking (non-fatal)`, err)
    }
  } else if (submissionId && !groupAssignmentId) {
    console.warn(`${tag} No groupAssignmentId provided — skipping AI marking enqueue`, { submissionId })
  }

  console.log(`${tag} Upload complete`, { submissionId, fileName, lessonId, activityId, pupilId, durationMs: Date.now() - startedAt })

  return NextResponse.json({ success: true, submissionId })
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/pupil-submission/upload-worksheet/route.ts
git commit -m "feat: add upload-worksheet pupil submission API route"
```

---

### Task 3: Pupil upload UI component

**Files:**
- Create: `src/components/pupil/pupil-upload-worksheet-activity.tsx`
- Modify: `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`

**Interfaces:**
- Consumes: `POST /api/pupil-submission/upload-worksheet` from Task 2; `LessonActivity` type; `ActivityProgressPanel` from `@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/activity-progress-panel`.
- Produces: `PupilUploadWorksheetActivity` component with the same props shape as `PupilUploadSpreadsheetActivity` — consumed by `page.tsx` rendering switch.

- [ ] **Step 1: Create the component**

Copy `src/components/pupil/pupil-upload-spreadsheet-activity.tsx` to the new path with these changes (full file):

```tsx
"use client"

import { useCallback, useRef, useState, useTransition, type ChangeEvent } from "react"
import { toast } from "sonner"
import { CheckCircle2, Loader2, Upload } from "lucide-react"

import type { LessonActivity } from "@/types"
import { Button } from "@/components/ui/button"
import { getRichTextMarkup } from "@/components/lessons/activity-view/utils"
import { ActivityProgressPanel } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/activity-progress-panel"

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic", ".heif"]
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

interface PupilUploadWorksheetActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canUpload: boolean
  initialFileName?: string | null
  feedbackAssignmentIds?: string[]
  feedbackLessonId?: string
  feedbackInitiallyVisible?: boolean
  scoreLabel?: string
  feedbackText?: string | null
}

export function PupilUploadWorksheetActivity({
  lessonId,
  activity,
  pupilId,
  canUpload,
  initialFileName = null,
  feedbackAssignmentIds = [],
  feedbackLessonId,
  feedbackInitiallyVisible = false,
  scoreLabel = "In progress",
  feedbackText,
}: PupilUploadWorksheetActivityProps) {
  const [isPending, startTransition] = useTransition()
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(initialFileName)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Guards against concurrent uploads caused by rapid double-tap or duplicate
  // onChange events, same as pupil-upload-activity.tsx.
  const uploadInProgress = useRef(false)

  const task = (activity.body_data as any)?.task ?? ""
  const hasTask = typeof task === "string" && task.trim().length > 0

  const uploadDisabled = !canUpload || isPending

  const beginUpload = useCallback(
    (incoming: FileList | File[]) => {
      if (uploadInProgress.current) return
      uploadInProgress.current = true

      const files = Array.from(incoming ?? []).filter((file) => file.size > 0)
      if (files.length === 0) {
        uploadInProgress.current = false
        return
      }

      const file = files[0]

      const lowerName = file.name.toLowerCase()
      if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
        toast.error(`Upload failed for ${file.name}`, {
          description: "Only JPEG, PNG, or HEIC photos are allowed.",
        })
        uploadInProgress.current = false
        return
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        toast.error(`Upload failed for ${file.name}`, {
          description: "File exceeds 10MB limit.",
        })
        uploadInProgress.current = false
        return
      }

      startTransition(async () => {
        try {
          setSelectedFileName(file.name)

          const formData = new FormData()
          formData.append("lessonId", lessonId)
          formData.append("activityId", activity.activity_id)
          formData.append("pupilId", pupilId)
          formData.append("file", file)
          if (feedbackAssignmentIds.length > 0) {
            formData.append("groupAssignmentId", feedbackAssignmentIds[0])
          }

          let result: { success: boolean; error?: string }
          try {
            const response = await fetch("/api/pupil-submission/upload-worksheet", {
              method: "POST",
              body: formData,
            })
            result = await response.json()
          } catch (err) {
            console.error("[pupil-upload-worksheet] Network error during upload", err)
            result = { success: false, error: "Network error, please try again." }
          }

          if (!result.success) {
            toast.error(`Upload failed for ${file.name}`, {
              description: result.error ?? "Please try again later.",
            })
            setSelectedFileName(null)
            return
          }

          toast.success(`Uploaded ${file.name}`)
          setUploadedFileName(file.name)
          setSelectedFileName(null)
        } finally {
          uploadInProgress.current = false
        }
      })
    },
    [activity.activity_id, feedbackAssignmentIds, lessonId, pupilId],
  )

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (isPending) {
        event.target.value = ""
        return
      }
      const files = event.target.files
      if (!files || files.length === 0) {
        setSelectedFileName(null)
        return
      }
      beginUpload(files)
      event.target.value = ""
    },
    [beginUpload, isPending],
  )

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload || uploadDisabled) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setIsDragActive(true)
  }, [canUpload, uploadDisabled])

  const handleDragLeave = useCallback(() => {
    setIsDragActive(false)
  }, [])

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload || uploadDisabled) return
    event.preventDefault()
    setIsDragActive(false)
    const files = event.dataTransfer.files
    if (!files || files.length === 0) {
      return
    }
    beginUpload(files)
  }, [beginUpload, canUpload, uploadDisabled])

  return (
    <div className="space-y-3 px-1">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">{activity.title}</h3>
            </div>
          </div>
          <span className="text-xs font-medium uppercase tracking-wide text-primary">Upload worksheet</span>
        </div>
      </div>

      {hasTask ? (
        <div
          className="prose prose-sm max-w-none text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: getRichTextMarkup(task) ?? "" }}
        />
      ) : null}

      {canUpload ? (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground" htmlFor={`upload-worksheet-${activity.activity_id}`}>
            Upload a photo of your completed worksheet
          </label>
          <div
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={[
              "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/40 p-4 text-center transition",
              canUpload && !uploadDisabled ? "cursor-pointer" : "cursor-not-allowed opacity-60",
              isDragActive ? "border-primary bg-primary/5" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              if (uploadDisabled) return
              fileInputRef.current?.click()
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (uploadDisabled) return
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                fileInputRef.current?.click()
              }
            }}
          >
            <Upload className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">Drag & drop a photo here</p>
            <p className="text-xs text-muted-foreground">or click to take/choose a photo</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation()
                if (uploadDisabled) return
                fileInputRef.current?.click()
              }}
              disabled={uploadDisabled}
            >
              Choose photo
            </Button>
            <input
              ref={fileInputRef}
              id={`upload-worksheet-${activity.activity_id}`}
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
              capture="environment"
              className="hidden"
              disabled={uploadDisabled}
              onChange={handleFileChange}
            />
          </div>
          {selectedFileName ? (
            <p className="text-xs text-muted-foreground">Uploading: {selectedFileName}</p>
          ) : null}
          {isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…
            </div>
          ) : null}
          {uploadedFileName ? (
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-100">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Uploaded <span className="font-medium">{uploadedFileName}</span>
              </span>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Photos are stored securely so your teacher can review them later. You can re-upload at any time.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Uploading is disabled in read-only mode. Sign in as the pupil to submit work.
        </p>
      )}

      <ActivityProgressPanel
        assignmentIds={feedbackAssignmentIds}
        lessonId={feedbackLessonId ?? lessonId}
        initialVisible={feedbackInitiallyVisible}
        show={true}
        scoreLabel={scoreLabel}
        feedbackText={feedbackText}
        modelAnswer={null}
        isMarked={scoreLabel !== "In progress" && scoreLabel !== "No score yet"}
      />
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the pupil lesson page**

In `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`:

Add the import next to the existing spreadsheet import (line 37):

```typescript
import { PupilUploadSpreadsheetActivity } from "@/components/pupil/pupil-upload-spreadsheet-activity"
import { PupilUploadWorksheetActivity } from "@/components/pupil/pupil-upload-worksheet-activity"
```

After the existing block at lines 431-439 (`uploadSpreadsheetActivities` / `uploadSpreadsheetFileNameEntries` / `uploadSpreadsheetFileNameMap`), add the analogous block for worksheets:

```typescript
  const uploadWorksheetActivities = activities.filter((activity) => activity.type === "upload-worksheet")
  const uploadWorksheetFileNameEntries = await Promise.all(
    uploadWorksheetActivities.map(async (activity) => {
      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      const body = (result.data?.body ?? null) as { fileName?: string } | null
      const fileName = typeof body?.fileName === "string" && body.fileName.trim().length > 0 ? body.fileName : null
      return [activity.activity_id, fileName] as const
    }),
  )
  const uploadWorksheetFileNameMap = new Map(uploadWorksheetFileNameEntries)
```

In the activity-type rendering switch (around line 1015), add a new branch right after the `upload-spreadsheet` branch:

```tsx
                      ) : activity.type === "upload-spreadsheet" ? (
                        <PupilUploadSpreadsheetActivity
                          lessonId={lesson.lesson_id}
                          activity={activity}
                          pupilId={pupilId}
                          canUpload={isPupilViewer}
                          initialFileName={uploadSpreadsheetFileNameMap.get(activity.activity_id) ?? null}
                          feedbackAssignmentIds={assignmentIds}
                          feedbackLessonId={lesson.lesson_id}
                          feedbackInitiallyVisible={initialFeedbackVisible}
                          scoreLabel={formatScoreLabel(rawScore)}
                          feedbackText={feedbackText}
                        />
                      ) : activity.type === "upload-worksheet" ? (
                        <PupilUploadWorksheetActivity
                          lessonId={lesson.lesson_id}
                          activity={activity}
                          pupilId={pupilId}
                          canUpload={isPupilViewer}
                          initialFileName={uploadWorksheetFileNameMap.get(activity.activity_id) ?? null}
                          feedbackAssignmentIds={assignmentIds}
                          feedbackLessonId={lesson.lesson_id}
                          feedbackInitiallyVisible={initialFeedbackVisible}
                          scoreLabel={formatScoreLabel(rawScore)}
                          feedbackText={feedbackText}
                        />
                      ) : activity.type === "short-text-question" ? (
```

(Only the `upload-worksheet` branch is new; the surrounding `upload-spreadsheet` and `short-text-question` branches already exist — insert between them.)

- [ ] **Step 3: Verify types compile**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/pupil/pupil-upload-worksheet-activity.tsx "src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx"
git commit -m "feat: add pupil upload-worksheet UI component and wire into lesson page"
```

---

### Task 4: AI marking queue — embed WORKSHEET_IMAGE

**Files:**
- Modify: `src/lib/ai/marking-queue.ts`

**Interfaces:**
- Consumes: `UploadWorksheetActivityBodySchema`, `UploadWorksheetSubmissionBodySchema` from Task 1; existing `createLocalStorageClient`, `invokeAiMarking`, `logQueueEvent`.
- Produces: marking-queue dispatch for `upload-worksheet` activities — payload includes `WORKSHEET_IMAGE` (base64 string).

- [ ] **Step 1: Add the import**

Near the top of `src/lib/ai/marking-queue.ts`, alongside the existing imports of `UploadSpreadsheetActivityBodySchema, UploadSpreadsheetSubmissionBodySchema`, add:

```typescript
import {
  UploadSpreadsheetActivityBodySchema,
  UploadSpreadsheetSubmissionBodySchema,
  UploadWorksheetActivityBodySchema,
  UploadWorksheetSubmissionBodySchema,
} from "@/types";
```

(Adjust to match however the existing import statement is structured — add the two new named imports to the same `from "@/types"` import.)

- [ ] **Step 2: Register the new type as supported**

Change:

```typescript
const SUPPORTED_TYPES = new Set(["short-text-question", "upload-spreadsheet"]);
```

to:

```typescript
const SUPPORTED_TYPES = new Set(["short-text-question", "upload-spreadsheet", "upload-worksheet"]);
```

- [ ] **Step 3: Branch on the new type**

Change the `if (context.type === "short-text-question") { ... } else { ... }` structure (lines ~218-289) to a three-way branch. Replace the closing `} else {` (the spreadsheet branch) with `} else if (context.type === "upload-spreadsheet") {`, and add a new `else if (context.type === "upload-worksheet") { ... }` branch before the final `}`:

```typescript
    if (context.type === "short-text-question") {
      const parsedActivity = ShortTextActivityBodySchema.parse(
        context.activity_body,
      );
      const parsedSubmission = ShortTextSubmissionBodySchema.parse(
        context.submission_body,
      );

      const doParams = {
        question: parsedActivity.question,
        model_answer: parsedActivity.modelAnswer,
        pupil_answer: parsedSubmission.answer || "",
        webhook_url: effectiveCallbackUrl,
        group_assignment_id: item.assignment_id,
        activity_id: context.activity_id as string,
        pupil_id: context.pupil_id as string,
        submission_id: item.submission_id,
      };

      await logQueueEvent(
        "info",
        `Triggering n8n workflow for submission ${item.submission_id}`,
        doParams,
      );

      await invokeAiMarking(doParams);
    } else if (context.type === "upload-spreadsheet") {
      const parsedActivity = UploadSpreadsheetActivityBodySchema.parse(
        context.activity_body,
      );
      const parsedSubmission = UploadSpreadsheetSubmissionBodySchema.parse(
        context.submission_body,
      );

      const storage = createLocalStorageClient("lessons");
      const { stream, error: streamError } = await storage.getFileStream(
        parsedSubmission.filePath,
      );
      if (streamError || !stream) {
        throw new Error(
          `Failed to read spreadsheet file at ${parsedSubmission.filePath}: ${streamError?.message ?? "no stream"}`,
        );
      }

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      const spreadsheetData = await parseSpreadsheet(buffer);
      const spreadsheetBase64 = buffer.toString("base64");

      const doParams = {
        task: parsedActivity.task,
        marking_guidance: parsedActivity.markingGuidance,
        spreadsheet_base64: spreadsheetBase64,
        spreadsheet_data: spreadsheetData,
        webhook_url: effectiveCallbackUrl,
        group_assignment_id: item.assignment_id,
        activity_id: context.activity_id as string,
        pupil_id: context.pupil_id as string,
        submission_id: item.submission_id,
      };

      await logQueueEvent(
        "info",
        `Triggering n8n workflow for spreadsheet submission ${item.submission_id}`,
      );

      await invokeAiMarking(doParams);
    } else {
      const parsedActivity = UploadWorksheetActivityBodySchema.parse(
        context.activity_body,
      );
      const parsedSubmission = UploadWorksheetSubmissionBodySchema.parse(
        context.submission_body,
      );

      const storage = createLocalStorageClient("lessons");
      const { stream, error: streamError } = await storage.getFileStream(
        parsedSubmission.filePath,
      );
      if (streamError || !stream) {
        throw new Error(
          `Failed to read worksheet image at ${parsedSubmission.filePath}: ${streamError?.message ?? "no stream"}`,
        );
      }

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      const worksheetImageBase64 = buffer.toString("base64");

      const doParams = {
        task: parsedActivity.task,
        marking_guidance: parsedActivity.markingGuidance,
        WORKSHEET_IMAGE: worksheetImageBase64,
        webhook_url: effectiveCallbackUrl,
        group_assignment_id: item.assignment_id,
        activity_id: context.activity_id as string,
        pupil_id: context.pupil_id as string,
        submission_id: item.submission_id,
      };

      await logQueueEvent(
        "info",
        `Triggering n8n workflow for worksheet submission ${item.submission_id}`,
      );

      await invokeAiMarking(doParams);
    }
```

- [ ] **Step 4: Add the new params shape to the AI marking client types**

In `src/lib/ai/ai-marking-client.ts`, add a new interface next to `SpreadsheetMarkingParams` and include it in the union:

```typescript
export interface WorksheetMarkingParams {
  task: string;
  marking_guidance: string;
  WORKSHEET_IMAGE: string;
  webhook_url?: string;
  group_assignment_id?: string;
  activity_id?: string;
  pupil_id?: string;
  submission_id?: string;
}

export type AiMarkingParams = ShortTextMarkingParams | SpreadsheetMarkingParams | WorksheetMarkingParams;
```

(Replace the existing `export type AiMarkingParams = ShortTextMarkingParams | SpreadsheetMarkingParams;` line with the union above, and insert the `WorksheetMarkingParams` interface above it.)

- [ ] **Step 5: Verify types compile**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/marking-queue.ts src/lib/ai/ai-marking-client.ts
git commit -m "feat: dispatch upload-worksheet submissions to AI marking with WORKSHEET_IMAGE"
```

---

### Task 5: Webhook callback — generalize submission schema selection

**Files:**
- Modify: `src/app/webhooks/ai-mark/route.ts`

**Interfaces:**
- Consumes: `UploadWorksheetSubmissionBodySchema` from Task 1.
- Produces: `applyAiMarkToSubmission` and the no-existing-submission skip path now handle `upload-worksheet` the same way they already handle `upload-spreadsheet`.

- [ ] **Step 1: Add the import and a file-required-types set**

Change:

```typescript
const UPLOAD_SPREADSHEET_ACTIVITY_TYPE = "upload-spreadsheet";
```

to:

```typescript
const UPLOAD_SPREADSHEET_ACTIVITY_TYPE = "upload-spreadsheet";
const UPLOAD_WORKSHEET_ACTIVITY_TYPE = "upload-worksheet";
const FILE_SUBMISSION_ACTIVITY_TYPES = new Set([
  UPLOAD_SPREADSHEET_ACTIVITY_TYPE,
  UPLOAD_WORKSHEET_ACTIVITY_TYPE,
]);
```

Add `UploadWorksheetSubmissionBodySchema` to the existing `@/types` import line that already imports `UploadSpreadsheetSubmissionBodySchema`.

- [ ] **Step 2: Update the no-existing-submission skip branch**

Change:

```typescript
      } else if (activityRow.type === UPLOAD_SPREADSHEET_ACTIVITY_TYPE) {
        console.warn(
          "[ai-mark-webhook] Skipping auto-creation of upload-spreadsheet submission: no existing submission with filePath/fileName found.",
          { activityId: parsed.data.activity_id, pupilId: resultPupilId },
        );
        await logQueueEvent(
          "warn",
          `Skipped creating upload-spreadsheet submission for pupil ${resultPupilId}: no existing submission (filePath/fileName required, cannot be fabricated)`,
          { activityId: parsed.data.activity_id, pupilId: resultPupilId },
        );
        summary.skipped += 1;
      } else {
```

to:

```typescript
      } else if (FILE_SUBMISSION_ACTIVITY_TYPES.has(activityRow.type ?? "")) {
        console.warn(
          `[ai-mark-webhook] Skipping auto-creation of ${activityRow.type} submission: no existing submission with filePath/fileName found.`,
          { activityId: parsed.data.activity_id, pupilId: resultPupilId },
        );
        await logQueueEvent(
          "warn",
          `Skipped creating ${activityRow.type} submission for pupil ${resultPupilId}: no existing submission (filePath/fileName required, cannot be fabricated)`,
          { activityId: parsed.data.activity_id, pupilId: resultPupilId },
        );
        summary.skipped += 1;
      } else {
```

- [ ] **Step 3: Update `applyAiMarkToSubmission` schema selection**

Change:

```typescript
  const isUploadSpreadsheet = activityType === UPLOAD_SPREADSHEET_ACTIVITY_TYPE;
  const submissionSchema = isUploadSpreadsheet
    ? UploadSpreadsheetSubmissionBodySchema
    : ShortTextSubmissionBodySchema;

  const parsedBody = submissionSchema.safeParse(
    submission.body ?? {},
  );
  if (!parsedBody.success && isUploadSpreadsheet) {
    // upload-spreadsheet requires filePath/fileName, which cannot be
    // fabricated here — an existing submission missing them indicates
    // corrupted data, so surface a clear error instead of writing a body
    // with empty file fields.
    throw new Error(
      `Existing upload-spreadsheet submission ${submission.submission_id} has an invalid body (missing filePath/fileName).`,
    );
  }
  const baseBody = parsedBody.success
    ? parsedBody.data
    : ShortTextSubmissionBodySchema.parse({});
```

to:

```typescript
  const isFileSubmission = FILE_SUBMISSION_ACTIVITY_TYPES.has(activityType ?? "");
  const submissionSchema = activityType === UPLOAD_WORKSHEET_ACTIVITY_TYPE
    ? UploadWorksheetSubmissionBodySchema
    : activityType === UPLOAD_SPREADSHEET_ACTIVITY_TYPE
      ? UploadSpreadsheetSubmissionBodySchema
      : ShortTextSubmissionBodySchema;

  const parsedBody = submissionSchema.safeParse(
    submission.body ?? {},
  );
  if (!parsedBody.success && isFileSubmission) {
    // upload-spreadsheet/upload-worksheet require filePath/fileName, which
    // cannot be fabricated here — an existing submission missing them
    // indicates corrupted data, so surface a clear error instead of writing
    // a body with empty file fields.
    throw new Error(
      `Existing ${activityType} submission ${submission.submission_id} has an invalid body (missing filePath/fileName).`,
    );
  }
  const baseBody = parsedBody.success
    ? parsedBody.data
    : ShortTextSubmissionBodySchema.parse({});
```

- [ ] **Step 4: Update the `answer` field exclusion**

Find the `...(isUploadSpreadsheet ? {} : { answer: ... })` spread further down (around line 525) and change `isUploadSpreadsheet` to `isFileSubmission`:

```typescript
    ...(isFileSubmission
      ? {}
      : { answer: (baseBody as { answer?: string }).answer ?? answerFallback ?? "" }),
```

- [ ] **Step 5: Verify types compile**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/webhooks/ai-mark/route.ts
git commit -m "feat: handle upload-worksheet submissions in AI mark webhook callback"
```

---

### Task 6: Teacher authoring UI — activity type, form fields, state plumbing

**Files:**
- Modify: `src/components/lessons/lesson-activities-manager.tsx`

**Interfaces:**
- Consumes: `UploadWorksheetActivityBody` type from Task 1.
- Produces: teacher can create/edit `upload-worksheet` activities with `task` + `markingGuidance` fields, identical UX to `upload-spreadsheet`.

- [ ] **Step 1: Add to the type import**

Change:

```typescript
import type {
  FeedbackActivityBody,
  FeedbackActivityGroupSettings,
  LessonActivity,
  UploadSpreadsheetActivityBody,
} from "@/types"
```

to:

```typescript
import type {
  FeedbackActivityBody,
  FeedbackActivityGroupSettings,
  LessonActivity,
  UploadSpreadsheetActivityBody,
  UploadWorksheetActivityBody,
} from "@/types"
```

- [ ] **Step 2: Add to the activity type picker**

Change line 94 area:

```typescript
  { value: "upload-spreadsheet", label: "Upload spreadsheet" },
```

to add immediately after it:

```typescript
  { value: "upload-spreadsheet", label: "Upload spreadsheet" },
  { value: "upload-worksheet", label: "Upload worksheet" },
```

- [ ] **Step 3: Add state and derived validation**

After:

```typescript
  const [uploadSpreadsheetBody, setUploadSpreadsheetBody] = useState<UploadSpreadsheetActivityBody>(() =>
    createDefaultUploadSpreadsheetBody(),
  )
```

add:

```typescript
  const [uploadWorksheetBody, setUploadWorksheetBody] = useState<UploadWorksheetActivityBody>(() =>
    createDefaultUploadWorksheetBody(),
  )
```

After:

```typescript
  const normalizedUploadSpreadsheetBody = useMemo(
    () => normalizeUploadSpreadsheetBody(uploadSpreadsheetBody),
    [uploadSpreadsheetBody],
  )
  const uploadSpreadsheetValidationMessage = useMemo(
    () => validateUploadSpreadsheetBody(normalizedUploadSpreadsheetBody),
    [normalizedUploadSpreadsheetBody],
  )
```

add:

```typescript
  const normalizedUploadWorksheetBody = useMemo(
    () => normalizeUploadWorksheetBody(uploadWorksheetBody),
    [uploadWorksheetBody],
  )
  const uploadWorksheetValidationMessage = useMemo(
    () => validateUploadWorksheetBody(normalizedUploadWorksheetBody),
    [normalizedUploadWorksheetBody],
  )
```

- [ ] **Step 4: Add change/commit handlers**

After:

```typescript
  const handleUploadSpreadsheetCommit = useCallback(() => {
    setUploadSpreadsheetBody((current) => normalizeUploadSpreadsheetBody(current))
  }, [])
```

add:

```typescript
  const handleUploadWorksheetTaskChange = useCallback((value: string) => {
    setUploadWorksheetBody((current) => ({ ...current, task: value }))
  }, [])

  const handleUploadWorksheetMarkingGuidanceChange = useCallback((value: string) => {
    setUploadWorksheetBody((current) => ({ ...current, markingGuidance: value }))
  }, [])

  const handleUploadWorksheetCommit = useCallback(() => {
    setUploadWorksheetBody((current) => normalizeUploadWorksheetBody(current))
  }, [])
```

- [ ] **Step 5: Reset state alongside the spreadsheet body in every reset site**

There are three reset call-sites that each call `setUploadSpreadsheetBody(createDefaultUploadSpreadsheetBody())` (form-close reset, new-activity reset, type-switch reset). At each of the following three locations, add the matching `setUploadWorksheetBody(createDefaultUploadWorksheetBody())` line immediately after:

Location A (sheet-close reset, ~line 2735):
```typescript
      setUploadSpreadsheetBody(createDefaultUploadSpreadsheetBody())
      setUploadWorksheetBody(createDefaultUploadWorksheetBody())
```

Location B (edit-existing-activity load, ~lines 2796-2800) — change:
```typescript
      if (ensuredType === "upload-spreadsheet") {
        setUploadSpreadsheetBody(normalizeUploadSpreadsheetBody(getUploadSpreadsheetBody(activity)))
      } else {
        setUploadSpreadsheetBody(createDefaultUploadSpreadsheetBody())
      }
```
to:
```typescript
      if (ensuredType === "upload-spreadsheet") {
        setUploadSpreadsheetBody(normalizeUploadSpreadsheetBody(getUploadSpreadsheetBody(activity)))
      } else {
        setUploadSpreadsheetBody(createDefaultUploadSpreadsheetBody())
      }
      if (ensuredType === "upload-worksheet") {
        setUploadWorksheetBody(normalizeUploadWorksheetBody(getUploadWorksheetBody(activity)))
      } else {
        setUploadWorksheetBody(createDefaultUploadWorksheetBody())
      }
```

Location C (second reset block, ~line 2859):
```typescript
      setUploadSpreadsheetBody(createDefaultUploadSpreadsheetBody())
      setUploadWorksheetBody(createDefaultUploadWorksheetBody())
```

- [ ] **Step 6: Handle the "new activity, type selected" early-return block**

After (~line 2940-2946):
```typescript
      if (type === "upload-spreadsheet") {
        setText("")
        setVideoUrl("")
        setRawBody("")
        setUploadSpreadsheetBody(createDefaultUploadSpreadsheetBody())
        return
      }
```
add:
```typescript
      if (type === "upload-worksheet") {
        setText("")
        setVideoUrl("")
        setRawBody("")
        setUploadWorksheetBody(createDefaultUploadWorksheetBody())
        return
      }
```

- [ ] **Step 7: Handle the "type changed while editing" block**

After (~lines 3134-3141):
```typescript
    if (type === "upload-spreadsheet") {
      if (activity) {
        setUploadSpreadsheetBody(normalizeUploadSpreadsheetBody(getUploadSpreadsheetBody(activity)))
      } else {
        setUploadSpreadsheetBody(createDefaultUploadSpreadsheetBody())
      }
      return
    }
```
add:
```typescript
    if (type === "upload-worksheet") {
      if (activity) {
        setUploadWorksheetBody(normalizeUploadWorksheetBody(getUploadWorksheetBody(activity)))
      } else {
        setUploadWorksheetBody(createDefaultUploadWorksheetBody())
      }
      return
    }
```

- [ ] **Step 8: Handle save-time body assembly and validation**

After (~lines 3554-3559):
```typescript
    } else if (type === "upload-spreadsheet") {
      if (uploadSpreadsheetValidationMessage) {
        toast.error(uploadSpreadsheetValidationMessage)
        return
      }
      bodyData = normalizedUploadSpreadsheetBody
```
add a sibling branch (before the next `} else if (type === "feedback")`):
```typescript
    } else if (type === "upload-worksheet") {
      if (uploadWorksheetValidationMessage) {
        toast.error(uploadWorksheetValidationMessage)
        return
      }
      bodyData = normalizedUploadWorksheetBody
```

- [ ] **Step 9: Add to the save-button-disabled condition**

Change:
```typescript
    (type === "upload-spreadsheet" && uploadSpreadsheetValidationMessage !== null)
```
to:
```typescript
    (type === "upload-spreadsheet" && uploadSpreadsheetValidationMessage !== null) ||
    (type === "upload-worksheet" && uploadWorksheetValidationMessage !== null)
```

- [ ] **Step 10: Add the form fields JSX**

After the closing of the `upload-spreadsheet` form block (find the `{type === "upload-spreadsheet" ? ( ... ) : null}` block, which ends a few lines after line 4228's `<p>` tag — locate its closing `) : null}`), add a sibling block:

```tsx
          {type === "upload-worksheet" ? (
            <div className="rounded-md border border-border bg-muted/20 p-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground" htmlFor="upload-worksheet-task">
                  Task
                </Label>
                <RichTextEditor
                  id="upload-worksheet-task"
                  value={uploadWorksheetBody.task}
                  onChange={handleUploadWorksheetTaskChange}
                  onBlur={handleUploadWorksheetCommit}
                  placeholder="Describe the worksheet task for pupils"
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground" htmlFor="upload-worksheet-marking-guidance">
                  Marking guidance (required)
                </Label>
                <RichTextEditor
                  id="upload-worksheet-marking-guidance"
                  value={uploadWorksheetBody.markingGuidance}
                  onChange={handleUploadWorksheetMarkingGuidanceChange}
                  onBlur={handleUploadWorksheetCommit}
                  placeholder="Describe how the AI should mark the worksheet photo"
                  disabled={isPending}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Marking guidance is not shown to the pupil — it is sent to the AI to mark the uploaded worksheet photo.
              </p>
            </div>
          ) : null}
```

- [ ] **Step 11: Exclude from the raw-JSON fallback editor**

Change:
```typescript
          type !== "upload-spreadsheet" &&
```
to:
```typescript
          type !== "upload-spreadsheet" &&
          type !== "upload-worksheet" &&
```

- [ ] **Step 12: Add the default/get/normalize/validate helper functions**

After the existing block (immediately following `validateUploadSpreadsheetBody`'s closing, ~line 4724-4726), add:

```typescript
function createDefaultUploadWorksheetBody(): UploadWorksheetActivityBody {
  return {
    task: "",
    markingGuidance: "",
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

  return {
    ...(record as Record<string, unknown>),
    task,
    markingGuidance,
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

  return {
    ...(body as Record<string, unknown>),
    task,
    markingGuidance,
  } as UploadWorksheetActivityBody
}

function validateUploadWorksheetBody(body: UploadWorksheetActivityBody): string | null {
  const task = typeof body.task === "string" ? body.task.trim() : ""
  if (!task) {
    return "Add the task text before saving."
  }

  const markingGuidance =
    typeof body.markingGuidance === "string" ? body.markingGuidance.trim() : ""
  if (!markingGuidance) {
    return "Marking guidance is required."
  }

  return null
}
```

- [ ] **Step 13: Verify types compile**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors.

- [ ] **Step 14: Commit**

```bash
git add src/components/lessons/lesson-activities-manager.tsx
git commit -m "feat: add upload-worksheet authoring UI to lesson activities manager"
```

---

### Task 7: Activity preview rendering (teacher-facing read views)

**Files:**
- Modify: `src/components/lessons/activity-view/index.tsx`

**Interfaces:**
- Consumes: `UploadWorksheetActivityBody`, `getRichTextMarkup` (already imported in this file).
- Produces: teacher-facing compact preview and full activity view both render `upload-worksheet` task text, matching the `upload-spreadsheet` treatment.

- [ ] **Step 1: Add a `getUploadWorksheetBody` helper**

This file already has `getUploadSpreadsheetBody` imported/defined somewhere for its own use (check the top of the file or `@/components/lessons/activity-view/utils` for where `getUploadSpreadsheetBody` comes from — if it's defined locally in this file, add a sibling; if imported from `utils.ts`, add it there instead and export it). Mirror whichever pattern this file already uses. The helper body must match Task 6's `getUploadWorksheetBody`:

```typescript
function getUploadWorksheetBody(activity: LessonActivity): UploadWorksheetActivityBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { task: "", markingGuidance: "" }
  }
  const record = activity.body_data as Record<string, unknown>
  return {
    ...(record as Record<string, unknown>),
    task: typeof record.task === "string" ? record.task : "",
    markingGuidance: typeof record.markingGuidance === "string" ? record.markingGuidance : "",
  } as UploadWorksheetActivityBody
}
```

- [ ] **Step 2: Add the compact-preview branch**

After (~lines 341-353):
```typescript
  } else if (activity.type === "upload-spreadsheet") {
    const uploadSpreadsheet = getUploadSpreadsheetBody(activity)
    const markup = getRichTextMarkup(uploadSpreadsheet.task)
    content = markup ? (
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Upload spreadsheet</p>
        <div
          className="prose prose-sm line-clamp-3 max-w-none dark:prose-invert text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">Upload spreadsheet task awaiting setup.</p>
    )
```
add:
```typescript
  } else if (activity.type === "upload-worksheet") {
    const uploadWorksheet = getUploadWorksheetBody(activity)
    const markup = getRichTextMarkup(uploadWorksheet.task)
    content = markup ? (
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Upload worksheet</p>
        <div
          className="prose prose-sm line-clamp-3 max-w-none dark:prose-invert text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">Upload worksheet task awaiting setup.</p>
    )
```

- [ ] **Step 3: Add the full-view branch**

After the `if (activity.type === "upload-spreadsheet") { ... return wrap(...) }` block (~lines 1209-1240ish, ends with the closing of that `if`), add a sibling `if` block:

```tsx
  if (activity.type === "upload-worksheet") {
    const uploadWorksheet = getUploadWorksheetBody(activity)
    const markup = getRichTextMarkup(uploadWorksheet.task)

    return wrap(
      <div className="space-y-4">
        {markup ? (
          <div
            className="prose prose-lg max-w-none dark:prose-invert text-foreground"
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        ) : (
          <p className="text-muted-foreground">Add a task so pupils know what to submit.</p>
        )}

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Share any reference files pupils should download before uploading their worksheet photo.
          </p>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files attached yet.</p>
          ) : (
            <ul className="space-y-1">
              {files.map((file) => (
                <li key={file.path}>{file.name}</li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Pupils can upload a photo of their completed worksheet from the student lesson page. Their photo is saved under this activity.
        </p>
      </div>
    )
  }
```

Match the exact `files` variable name and `<ul>`/list rendering already used in the existing `upload-spreadsheet` block — read the surrounding 20 lines before writing this to copy the real markup verbatim instead of guessing.

- [ ] **Step 4: Verify types compile**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/lessons/activity-view/index.tsx
git commit -m "feat: add upload-worksheet teacher preview rendering"
```

---

### Task 8: Assignment results dashboard — listing and override tab

**Files:**
- Modify: `src/components/assignment-results/assignment-results-dashboard.tsx`

**Interfaces:**
- Consumes: nothing new — pure activity-type string matching.
- Produces: teacher assignment-results view lists `upload-worksheet` submissions as downloadable files and shows the "Automatic score" tab for them, matching `upload-spreadsheet`.

- [ ] **Step 1: Add to the file-listing type set**

Change:
```typescript
const UPLOAD_LISTING_ACTIVITY_TYPES = new Set(["upload-file", "upload-spreadsheet"])
```
to:
```typescript
const UPLOAD_LISTING_ACTIVITY_TYPES = new Set(["upload-file", "upload-spreadsheet", "upload-worksheet"])
```

- [ ] **Step 2: Add to the automatic-score tab condition**

Change:
```typescript
                      {(selection.activity.type === "short-text-question" ||
                        selection.activity.type === "upload-spreadsheet") && (
                        <TabsTrigger value="auto" className="flex-1">Automatic score</TabsTrigger>
                      )}
```
to:
```typescript
                      {(selection.activity.type === "short-text-question" ||
                        selection.activity.type === "upload-spreadsheet" ||
                        selection.activity.type === "upload-worksheet") && (
                        <TabsTrigger value="auto" className="flex-1">Automatic score</TabsTrigger>
                      )}
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/assignment-results/assignment-results-dashboard.tsx
git commit -m "feat: list upload-worksheet submissions in assignment results dashboard"
```

---

### Task 9: End-to-end manual verification

**Files:** None (verification only).

- [ ] **Step 1: Lint and typecheck the whole repo**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: No errors introduced by this feature (pre-existing unrelated warnings are fine).

- [ ] **Step 2: Manual walkthrough in the dev server**

With the dev server running (tmux session `planner-004`, port 3000):
1. As a teacher, open a lesson, add a new activity, select "Upload worksheet" from the type picker, fill in Task and Marking guidance, save.
2. Confirm the activity appears in the lesson activity list with the "Upload worksheet" preview text.
3. As a pupil viewing that lesson, confirm the upload widget renders ("Upload a photo of your completed worksheet"), and that selecting a `.jpg`/`.png`/`.heic` file under 10MB uploads successfully (toast "Uploaded …" appears).
4. Confirm a `.gif` or an 11MB file is rejected client-side with the correct error toast.
5. Check server logs in the tmux session for `[pupil-upload-worksheet:...] Upload complete` — confirm `submissionId` is set and no errors.
6. In the assignment results dashboard (as teacher), confirm the worksheet submission is listed as a downloadable file and the "Automatic score" tab is present.

- [ ] **Step 3: Commit any fixes found during manual walkthrough**

If issues are found, fix them in the relevant task's files and commit:
```bash
git add -A
git commit -m "fix: address issues found in upload-worksheet manual verification"
```
