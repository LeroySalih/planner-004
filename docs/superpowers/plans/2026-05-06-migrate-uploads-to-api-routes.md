# Migrate File Uploads to API Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all remaining file-upload server actions with dedicated Next.js API routes so Cloudflare's "React - Leaking Server Functions" managed rule (CVE-2025-55183) cannot block legitimate pupil and teacher uploads.

**Architecture:** Each upload server action is replaced 1-for-1 with a `POST` handler under `src/app/api/`. The handler contains identical logic (auth, storage upload, DB upsert, SSE emit) plus structured per-request logging. Client components are updated to call `fetch(...)` instead of the server action — no other behaviour changes.

**Tech Stack:** Next.js 16 App Router, TypeScript, `pg` (direct PostgreSQL), `createLocalStorageClient` from `@/lib/storage/local-storage`, `emitSubmissionEvent`/`emitUploadEvent` from `@/lib/sse/topics`, `logActivitySubmissionEvent` from `@/lib/activity-logging`, Zod.

---

## Context: already-migrated reference

`uploadPupilActivitySubmissionAction` was already migrated in a previous session.  
Use `src/app/api/pupil-submission/upload/route.ts` as the structural template for every new route in this plan — same logging pattern (`[tag:requestId]`), same `createPgClient()` helper, same rollback-on-DB-failure pattern.

---

## File Map

| New file | Replaces action | Called from |
|---|---|---|
| `src/app/api/share-my-work/upload/route.ts` | `uploadShareMyWorkImageAction` | `pupil-share-my-work-activity.tsx` |
| `src/app/api/sketch-render/save/route.ts` | `saveSketchRenderAnswerAction` | `pupil-sketch-render-activity.tsx` |
| `src/app/api/activity-files/upload/route.ts` | `uploadActivityFileAction` | `lesson-activities-manager.tsx`, `lesson-sidebar.tsx` |
| `src/app/api/lesson-files/upload/route.ts` | `uploadLessonFileAction` | `lesson-files-manager.tsx`, `lesson-sidebar.tsx` |
| `src/app/api/unit-files/upload/route.ts` | `uploadUnitFileAction` | `unit-files-panel.tsx` |

Components modified (imports updated, `fetch` call replacing server action):
- `src/components/pupil/pupil-share-my-work-activity.tsx`
- `src/components/lessons/activity-view/pupil-sketch-render-activity.tsx`
- `src/components/lessons/lesson-activities-manager.tsx`
- `src/components/units/lesson-sidebar.tsx`
- `src/components/lessons/lesson-files-manager.tsx`
- `src/components/units/unit-files-panel.tsx`

---

## Task 1: Share-My-Work image upload

**Files:**
- Create: `src/app/api/share-my-work/upload/route.ts`
- Modify: `src/components/pupil/pupil-share-my-work-activity.tsx`

### What the old action did
`uploadShareMyWorkImageAction` in `src/lib/server-actions/peer-review.ts`:
- Validates MIME type (only `image/png`, `image/jpeg`, `image/gif`, `image/webp`)
- Auth via `requireAuthenticatedProfile()`
- Uploads to `lessons` bucket at `lessons/{lessonId}/activities/{activityId}/{pupilStorageKey}/{fileName}`
- Upserts a `submissions` row — adds `{ fileId, fileName, mimeType, order }` to `body.files` array
- Returns `{ success: true, data: { fileId, fileName, submissionId } }` on success

### Component call site
`src/components/pupil/pupil-share-my-work-activity.tsx` lines 129–134:
```ts
const formData = new FormData()
formData.append("lessonId", lessonId)
formData.append("activityId", activity.activity_id)
formData.append("file", file)
const result = await uploadShareMyWorkImageAction(formData)
```
The component uses `result.success`, `result.error`, and `result.data.fileId` / `result.data.fileName` / `result.data.submissionId`.

- [ ] **Step 1: Create the API route**

Create `src/app/api/share-my-work/upload/route.ts`:

```ts
import { NextResponse } from "next/server"
import { Client } from "pg"

import { getAuthenticatedProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

function buildSubmissionPath(lessonId: string, activityId: string, pupilStorageKey: string, fileName: string) {
  return `lessons/${lessonId}/activities/${activityId}/${pupilStorageKey}/${fileName}`
}

function createPgClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL is not configured")
  return new Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  })
}

async function resolvePupilStorageKey(userId: string): Promise<string> {
  const { rows } = await query<{ email: string | null }>(
    `select email from profiles where user_id = $1 limit 1`,
    [userId],
  )
  return rows[0]?.email?.trim() ?? userId
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[share-my-work-upload:${requestId}]`
  const startedAt = Date.now()

  console.log(`${tag} Request received`)

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    console.warn(`${tag} Rejected: unauthenticated`)
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
  const file = formData.get("file")

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing lessonId" }, { status: 400 })
  }
  if (typeof activityId !== "string" || activityId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing activityId" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    console.warn(`${tag} Rejected MIME type: ${file.type}`)
    return NextResponse.json(
      { success: false, error: "Only PNG, JPEG, GIF, and WebP images are allowed" },
      { status: 415 },
    )
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    console.warn(`${tag} File too large: ${file.size} bytes`, { fileName: file.name })
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit" }, { status: 413 })
  }

  const userId = profile.userId
  const fileName = file.name

  console.log(`${tag} Uploading`, { fileName, fileSize: file.size, fileType: file.type, lessonId, activityId })

  const pupilStorageKey = profile.email?.trim() ?? (await resolvePupilStorageKey(userId))
  const path = buildSubmissionPath(lessonId, activityId, pupilStorageKey, fileName)
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadError } = await storage.upload(path, arrayBuffer, {
    contentType: file.type,
    uploadedBy: userId,
    originalPath: path,
  })

  if (uploadError) {
    console.error(`${tag} Storage upload failed`, { path, error: uploadError.message })
    return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
  }

  console.log(`${tag} Storage upload succeeded`, { path, durationMs: Date.now() - startedAt })

  const fileId = crypto.randomUUID()
  const client = createPgClient()
  let submissionId: string

  try {
    await client.connect()

    const { rows: existingRows } = await client.query(
      `select submission_id, body from submissions where activity_id = $1 and user_id = $2 order by submitted_at desc limit 1`,
      [activityId, userId],
    )

    const existing = existingRows[0]
    const files: Array<{ fileId: string; fileName: string; mimeType: string; order: number }> =
      existing?.body?.files && Array.isArray(existing.body.files) ? existing.body.files : []

    files.push({ fileId, fileName, mimeType: file.type, order: files.length })

    const body = { files }
    const submittedAt = new Date().toISOString()

    if (existing) {
      submissionId = existing.submission_id
      await client.query(
        `update submissions set body = $1, submitted_at = $2 where submission_id = $3`,
        [JSON.stringify(body), submittedAt, submissionId],
      )
      console.log(`${tag} Updated existing submission`, { submissionId })
    } else {
      const { rows: insertRows } = await client.query<{ submission_id: string }>(
        `insert into submissions (submission_id, activity_id, user_id, body, submitted_at) values (gen_random_uuid(), $1, $2, $3, $4) returning submission_id`,
        [activityId, userId, JSON.stringify(body), submittedAt],
      )
      submissionId = insertRows[0].submission_id
      console.log(`${tag} Created new submission`, { submissionId })
    }
  } catch (err) {
    console.error(`${tag} DB upsert failed — rolling back storage`, { path, error: err })
    await storage.remove([path])
    return NextResponse.json({ success: false, error: "Failed to save submission" }, { status: 500 })
  } finally {
    try { await client.end() } catch { /* ignore */ }
  }

  console.log(`${tag} Complete`, { submissionId, fileName, totalMs: Date.now() - startedAt })
  return NextResponse.json({ success: true, data: { fileId, fileName, submissionId } })
}
```

- [ ] **Step 2: Update the component**

In `src/components/pupil/pupil-share-my-work-activity.tsx`:

Remove `uploadShareMyWorkImageAction` from the import:
```ts
// Before
import {
  uploadShareMyWorkImageAction,
  removeShareMyWorkImageAction,
  ...
} from "@/lib/server-updates"

// After
import {
  removeShareMyWorkImageAction,
  ...
} from "@/lib/server-updates"
```

Replace the server action call (lines ~129–136):
```ts
// Before
const result = await uploadShareMyWorkImageAction(formData)

// After
let result: { success: boolean; error?: string; data?: { fileId: string; fileName: string; submissionId: string } }
try {
  const response = await fetch("/api/share-my-work/upload", { method: "POST", body: formData })
  result = await response.json()
} catch (err) {
  console.error("[share-my-work] Network error during upload", err)
  result = { success: false, error: "Network error, please try again." }
}
```

- [ ] **Step 3: Smoke test**

With the dev server running on port 3003:
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3003/api/share-my-work/upload \
  -F "lessonId=test" -F "activityId=test"
```
Expected output: `401` (unauthenticated — proves the route is reachable and auth is working)

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit 2>&1 | grep -v "tests/"
```
Expected: no errors related to the changed files.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/share-my-work/ src/components/pupil/pupil-share-my-work-activity.tsx
git commit -m "fix(upload): migrate share-my-work image upload to API route"
```

---

## Task 2: Sketch-render save (includes file upload)

**Files:**
- Create: `src/app/api/sketch-render/save/route.ts`
- Modify: `src/components/lessons/activity-view/pupil-sketch-render-activity.tsx`

### What the old action did
`saveSketchRenderAnswerAction` in `src/lib/server-actions/sketch-render-activity.ts`:
- Validates `activityId`, `userId`, optional `assignmentId`, optional `prompt`, optional `originalFile`
- If `originalFile` is present and non-empty: uploads to `lessons/{lessonId}/activities/{activityId}/{storageKey}/sketch_original_{timestamp}_{fileName}` in `lessons` bucket
- Fetches `lessonId` via `getActivityLessonId(activityId)` from `@/lib/activity-logging`
- Fetches `successCriteriaIds` via `fetchActivitySuccessCriteriaIds(activityId)` from `@/lib/scoring/success-criteria`
- Upserts submission with `SketchRenderSubmissionBodySchema` body
- Calls `logActivitySubmissionEvent` and `emitSubmissionEvent("submission.updated", ...)`
- Returns `{ success: true, data: <Submission row> }` or `{ success: false, error: string, data: null }`

### Component call sites
`src/components/lessons/activity-view/pupil-sketch-render-activity.tsx` lines 120–128 and 145–152 both do:
```ts
const formData = new FormData()
formData.append("activityId", activity.activity_id)
formData.append("userId", userId)
if (assignmentId) formData.append("assignmentId", assignmentId)
formData.append("prompt", prompt)
if (originalFile) formData.append("originalFile", originalFile)
const result = await saveSketchRenderAnswerAction(formData)
```
The component uses `result.success`, `result.error`, and `result.data` (a full `Submission` row).

- [ ] **Step 1: Create the API route**

Create `src/app/api/sketch-render/save/route.ts`:

```ts
import { NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { getActivityLessonId, logActivitySubmissionEvent } from "@/lib/activity-logging"
import { fetchActivitySuccessCriteriaIds, normaliseSuccessCriteriaScores } from "@/lib/scoring/success-criteria"
import { SketchRenderSubmissionBodySchema, SubmissionSchema } from "@/types"

async function resolvePupilStorageKey(userId: string): Promise<string> {
  const { rows } = await query<{ email: string | null }>(
    `select email from profiles where user_id = $1 limit 1`,
    [userId],
  )
  return rows[0]?.email?.trim() ?? userId
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[sketch-render-save:${requestId}]`
  const startedAt = Date.now()

  console.log(`${tag} Request received`)

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    console.warn(`${tag} Rejected: unauthenticated`)
    return NextResponse.json({ success: false, error: "Unauthorized", data: null }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error(`${tag} Failed to parse form data`, err)
    return NextResponse.json({ success: false, error: "Invalid request body", data: null }, { status: 400 })
  }

  const activityId = formData.get("activityId")
  const userId = formData.get("userId")
  const assignmentId = formData.get("assignmentId")
  const prompt = formData.get("prompt")
  const originalFile = formData.get("originalFile")

  if (typeof activityId !== "string" || activityId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing activityId", data: null }, { status: 400 })
  }
  if (typeof userId !== "string" || userId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing userId", data: null }, { status: 400 })
  }

  // Auth check: session user must match the userId being saved
  if (profile.userId !== userId) {
    console.warn(`${tag} Auth mismatch: session=${profile.userId} requested userId=${userId}`)
    return NextResponse.json({ success: false, error: "Unauthorized", data: null }, { status: 403 })
  }

  console.log(`${tag} Saving sketch`, {
    activityId,
    userId,
    hasFile: originalFile instanceof File && originalFile.size > 0,
    promptLength: typeof prompt === "string" ? prompt.length : 0,
  })

  const lessonId = await getActivityLessonId(activityId)
  if (!lessonId) {
    console.error(`${tag} lessonId not found for activityId`, { activityId })
    return NextResponse.json({ success: false, error: "Configuration error: Lesson ID missing", data: null }, { status: 500 })
  }

  const storageKey = profile.email?.trim() ?? (await resolvePupilStorageKey(userId))
  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(activityId)
  const initialScores = normaliseSuccessCriteriaScores({ successCriteriaIds, fillValue: 0 })

  // Upload original file if provided
  let originalFilePath: string | null = null
  if (originalFile instanceof File && originalFile.size > 0) {
    try {
      const storage = createLocalStorageClient("lessons")
      const fileName = `sketch_original_${Date.now()}_${originalFile.name}`
      const path = `lessons/${lessonId}/activities/${activityId}/${storageKey}/${fileName}`
      const buffer = Buffer.from(await originalFile.arrayBuffer())
      const { error } = await storage.upload(path, buffer)
      if (error) throw new Error(error.message)
      originalFilePath = fileName
      console.log(`${tag} Original file uploaded`, { path, durationMs: Date.now() - startedAt })
    } catch (err) {
      console.error(`${tag} Failed to upload original sketch file`, err)
      return NextResponse.json({ success: false, error: "Failed to upload sketch image", data: null }, { status: 500 })
    }
  }

  // Load existing submission to preserve paths and scores
  let existingSubmission = null
  try {
    const { rows } = await query(`select * from submissions where activity_id = $1 and user_id = $2 limit 1`, [activityId, userId])
    existingSubmission = rows[0] ? SubmissionSchema.parse(rows[0]) : null
  } catch {
    // ignore — treat as no existing submission
  }

  const existingBody = existingSubmission ? SketchRenderSubmissionBodySchema.safeParse(existingSubmission.body).data : null
  const finalOriginalPath = originalFilePath ?? existingBody?.original_file_path ?? null
  const finalRenderedPath = existingBody?.rendered_file_path ?? null

  const submissionBody = SketchRenderSubmissionBodySchema.parse({
    prompt: (typeof prompt === "string" ? prompt : "").trim(),
    original_file_path: finalOriginalPath,
    rendered_file_path: finalRenderedPath,
    ai_model_score: existingBody?.ai_model_score ?? null,
    ai_model_feedback: existingBody?.ai_model_feedback ?? null,
    teacher_override_score: existingBody?.teacher_override_score ?? null,
    is_correct: existingBody?.is_correct ?? false,
    success_criteria_scores: existingBody?.success_criteria_scores ?? initialScores,
  })

  const timestamp = new Date().toISOString()
  let saved: any

  try {
    if (existingSubmission?.submission_id) {
      const result = await query(
        `update submissions set body = $1, submitted_at = $2, is_flagged = false where submission_id = $3 returning *`,
        [submissionBody, timestamp, existingSubmission.submission_id],
      )
      saved = result.rows[0]
    } else {
      const result = await query(
        `insert into submissions (activity_id, user_id, body, submitted_at, is_flagged) values ($1, $2, $3, $4, false) returning *`,
        [activityId, userId, submissionBody, timestamp],
      )
      saved = result.rows[0]
    }
  } catch (err) {
    console.error(`${tag} DB upsert failed`, err)
    return NextResponse.json({ success: false, error: "Failed to save submission", data: null }, { status: 500 })
  }

  if (!saved) {
    return NextResponse.json({ success: false, error: "Failed to save", data: null }, { status: 500 })
  }

  void logActivitySubmissionEvent({
    submissionId: saved.submission_id,
    activityId,
    lessonId,
    pupilId: userId,
    fileName: submissionBody.original_file_path ?? null,
    submittedAt: saved.submitted_at ?? timestamp,
  })

  void emitSubmissionEvent("submission.updated", {
    submissionId: saved.submission_id,
    activityId,
    pupilId: userId,
    submittedAt: saved.submitted_at ?? timestamp,
    submissionStatus: "inprogress",
    isFlagged: false,
  })

  const totalMs = Date.now() - startedAt
  console.log(`${tag} Complete`, { submissionId: saved.submission_id, activityId, totalMs })

  return NextResponse.json({ success: true, data: saved })
}
```

- [ ] **Step 2: Update the component**

In `src/components/lessons/activity-view/pupil-sketch-render-activity.tsx`:

Remove `saveSketchRenderAnswerAction` from the import. Then replace both call sites (lines ~128 and ~152):

```ts
// Before (both instances)
const result = await saveSketchRenderAnswerAction(formData)

// After (both instances — identical replacement)
let result: { success: boolean; error?: string; data: any | null }
try {
  const response = await fetch("/api/sketch-render/save", { method: "POST", body: formData })
  result = await response.json()
} catch (err) {
  console.error("[sketch-render] Network error during save", err)
  result = { success: false, error: "Network error, please try again.", data: null }
}
```

- [ ] **Step 3: Smoke test**

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3003/api/sketch-render/save \
  -F "activityId=test" -F "userId=test"
```
Expected: `401`

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit 2>&1 | grep -v "tests/"
```
Expected: no errors in the changed files.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sketch-render/ src/components/lessons/activity-view/pupil-sketch-render-activity.tsx
git commit -m "fix(upload): migrate sketch-render save to API route"
```

---

## Task 3: Activity file upload (teacher-facing)

**Files:**
- Create: `src/app/api/activity-files/upload/route.ts`
- Modify: `src/components/lessons/lesson-activities-manager.tsx`
- Modify: `src/components/units/lesson-sidebar.tsx`

### What the old action did
`uploadActivityFileAction` in `src/lib/server-actions/lesson-activity-files.ts`:
- Auth via `requireAuthenticatedProfile()`
- Accepts `unitId`, `lessonId`, `activityId`, `file`
- Uploads to `lessons` bucket at `lessons/{lessonId}/activities/{activityId}/{fileName}`
- Emits SSE event `upload.activity.file_added` via `emitUploadEvent`
- Returns `{ success: true }` or `{ success: false, error: string }`

### Component call sites (identical pattern in both components)
```ts
const formData = new FormData()
formData.append("unitId", unitId)
formData.append("lessonId", lessonId)
formData.append("activityId", activityId)
formData.append("file", file)
const result = await uploadActivityFileAction(formData)
```

- [ ] **Step 1: Create the API route**

Create `src/app/api/activity-files/upload/route.ts`:

```ts
import { NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitUploadEvent } from "@/lib/sse/topics"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

function buildFilePath(lessonId: string, activityId: string, fileName: string) {
  return `lessons/${lessonId}/activities/${activityId}/${fileName}`
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[activity-files-upload:${requestId}]`
  const startedAt = Date.now()

  console.log(`${tag} Request received`)

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    console.warn(`${tag} Rejected: unauthenticated`)
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error(`${tag} Failed to parse form data`, err)
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 })
  }

  const unitId = formData.get("unitId")
  const lessonId = formData.get("lessonId")
  const activityId = formData.get("activityId")
  const file = formData.get("file")

  if (typeof unitId !== "string" || unitId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing unitId" }, { status: 400 })
  }
  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing lessonId" }, { status: 400 })
  }
  if (typeof activityId !== "string" || activityId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing activityId" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    console.warn(`${tag} File too large: ${file.size} bytes`, { fileName: file.name })
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit" }, { status: 413 })
  }

  const fileName = file.name
  const fullPath = buildFilePath(lessonId, activityId, fileName)

  console.log(`${tag} Uploading`, { fileName, fileSize: file.size, lessonId, activityId, unitId })

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const arrayBuffer = await file.arrayBuffer()
  const { error } = await storage.upload(fullPath, arrayBuffer, {
    contentType: file.type || "application/octet-stream",
    uploadedBy: profile.userId,
    originalPath: fullPath,
  })

  if (error) {
    console.error(`${tag} Storage upload failed`, { fullPath, error: error.message })
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  try {
    await emitUploadEvent("upload.activity.file_added", {
      unitId,
      lessonId,
      activityId,
      fileName,
      submittedBy: profile.userId,
    })
  } catch (err) {
    console.error(`${tag} SSE emit failed (non-fatal)`, err)
  }

  console.log(`${tag} Complete`, { fullPath, totalMs: Date.now() - startedAt })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Update lesson-activities-manager.tsx**

In `src/components/lessons/lesson-activities-manager.tsx`, remove `uploadActivityFileAction` from the import, then replace all call sites (there are 5: lines ~473, ~540, ~649, and two more). Each replacement is:

```ts
// Before
const result = await uploadActivityFileAction(formData)

// After
let result: { success: boolean; error?: string }
try {
  const response = await fetch("/api/activity-files/upload", { method: "POST", body: formData })
  result = await response.json()
} catch (err) {
  console.error("[activity-files] Network error during upload", err)
  result = { success: false, error: "Network error, please try again." }
}
```

- [ ] **Step 3: Update lesson-sidebar.tsx (activity file calls only)**

In `src/components/units/lesson-sidebar.tsx`, remove `uploadActivityFileAction` from the import.

Replace the two `uploadActivityFileAction` call sites (lines ~739 and ~888):

```ts
// Before
const uploadResult = await uploadActivityFileAction(formData)
// or
const result = await uploadActivityFileAction(formData)

// After (same pattern for both)
let uploadResult: { success: boolean; error?: string }
try {
  const response = await fetch("/api/activity-files/upload", { method: "POST", body: formData })
  uploadResult = await response.json()
} catch (err) {
  console.error("[lesson-sidebar] Network error during activity file upload", err)
  uploadResult = { success: false, error: "Network error, please try again." }
}
```

- [ ] **Step 4: Smoke test**

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3003/api/activity-files/upload \
  -F "unitId=test" -F "lessonId=test" -F "activityId=test"
```
Expected: `401`

- [ ] **Step 5: Type-check**

```bash
pnpm tsc --noEmit 2>&1 | grep -v "tests/"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/activity-files/ src/components/lessons/lesson-activities-manager.tsx src/components/units/lesson-sidebar.tsx
git commit -m "fix(upload): migrate activity file upload to API route"
```

---

## Task 4: Lesson file upload (teacher-facing)

**Files:**
- Create: `src/app/api/lesson-files/upload/route.ts`
- Modify: `src/components/lessons/lesson-files-manager.tsx`
- Modify: `src/components/units/lesson-sidebar.tsx` (lesson file call only)

### What the old action did
`uploadLessonFileAction` in `src/lib/server-actions/lesson-files.ts`:
- No auth check (note: the action has no `requireAuthenticatedProfile` — add one in the API route for safety)
- Accepts `unitId`, `lessonId`, `file`
- Uploads to `lessons` bucket at `{lessonId}/{fileName}`
- After upload, re-lists the directory and returns the fresh file list
- Returns `{ success: true, error: null, files: LessonFile[] }` or `{ success: false, error: string }`

The component uses `result.success`, `result.error`, and `result.files` (to update the UI without a separate list call).

### Component call sites
```ts
// lesson-files-manager.tsx lines ~92–97
const formData = new FormData()
formData.append("unitId", unitId)
formData.append("lessonId", lessonId)
formData.append("file", file)
const result = await uploadLessonFileAction(formData)

// lesson-sidebar.tsx lines ~1139–1145
const formData = new FormData()
formData.append("unitId", unitId)
formData.append("lessonId", lesson.lesson_id)
formData.append("file", file)
const result = await uploadLessonFileAction(formData)
```

- [ ] **Step 1: Create the API route**

Create `src/app/api/lesson-files/upload/route.ts`:

```ts
import { NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

function buildFilePath(lessonId: string, fileName: string) {
  return `${lessonId}/${fileName}`
}

function toIsoOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  return undefined
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[lesson-files-upload:${requestId}]`
  const startedAt = Date.now()

  console.log(`${tag} Request received`)

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    console.warn(`${tag} Rejected: unauthenticated`)
    return NextResponse.json({ success: false, error: "Unauthorized", files: null }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error(`${tag} Failed to parse form data`, err)
    return NextResponse.json({ success: false, error: "Invalid request body", files: null }, { status: 400 })
  }

  const lessonId = formData.get("lessonId")
  const unitId = formData.get("unitId")
  const file = formData.get("file")

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing lessonId", files: null }, { status: 400 })
  }
  if (typeof unitId !== "string" || unitId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing unitId", files: null }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided", files: null }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    console.warn(`${tag} File too large: ${file.size} bytes`, { fileName: file.name })
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit", files: null }, { status: 413 })
  }

  const fileName = file.name
  const fullPath = buildFilePath(lessonId, fileName)

  console.log(`${tag} Uploading`, { fileName, fileSize: file.size, lessonId, unitId })

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const arrayBuffer = await file.arrayBuffer()
  const { error } = await storage.upload(fullPath, arrayBuffer, {
    contentType: file.type || "application/octet-stream",
    originalPath: fullPath,
  })

  if (error) {
    console.error(`${tag} Storage upload failed`, { fullPath, error: error.message })
    return NextResponse.json({ success: false, error: error.message, files: null }, { status: 500 })
  }

  // Re-list directory so the client can refresh without a separate fetch
  let files = null
  try {
    const { data: freshList, error: listError } = await storage.list(lessonId, { limit: 100 })
    if (!listError) {
      files = freshList?.map((item) => ({
        name: item.name,
        path: buildFilePath(lessonId, item.name),
        created_at: toIsoOrUndefined(item.created_at),
        updated_at: toIsoOrUndefined(item.updated_at),
        last_accessed_at: toIsoOrUndefined(item.last_accessed_at),
        size: item.metadata?.size ?? undefined,
      })) ?? null
    }
  } catch (listErr) {
    console.warn(`${tag} Unable to refresh file list after upload (non-fatal)`, listErr)
  }

  console.log(`${tag} Complete`, { fullPath, totalMs: Date.now() - startedAt })
  return NextResponse.json({ success: true, error: null, files })
}
```

- [ ] **Step 2: Update lesson-files-manager.tsx**

Remove `uploadLessonFileAction` from the import. Replace the call site:

```ts
// Before
const result = await uploadLessonFileAction(formData)

// After
let result: { success: boolean; error?: string | null; files?: any[] | null }
try {
  const response = await fetch("/api/lesson-files/upload", { method: "POST", body: formData })
  result = await response.json()
} catch (err) {
  console.error("[lesson-files] Network error during upload", err)
  result = { success: false, error: "Network error, please try again." }
}
```

- [ ] **Step 3: Update lesson-sidebar.tsx (lesson file call)**

Remove `uploadLessonFileAction` from the import. Replace the call site at line ~1145:

```ts
// Before
const result = await uploadLessonFileAction(formData)

// After
let result: { success: boolean; error?: string | null; files?: any[] | null }
try {
  const response = await fetch("/api/lesson-files/upload", { method: "POST", body: formData })
  result = await response.json()
} catch (err) {
  console.error("[lesson-sidebar] Network error during lesson file upload", err)
  result = { success: false, error: "Network error, please try again." }
}
```

- [ ] **Step 4: Smoke test**

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3003/api/lesson-files/upload \
  -F "unitId=test" -F "lessonId=test"
```
Expected: `401`

- [ ] **Step 5: Type-check**

```bash
pnpm tsc --noEmit 2>&1 | grep -v "tests/"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/lesson-files/ src/components/lessons/lesson-files-manager.tsx src/components/units/lesson-sidebar.tsx
git commit -m "fix(upload): migrate lesson file upload to API route"
```

---

## Task 5: Unit file upload (teacher-facing)

**Files:**
- Create: `src/app/api/unit-files/upload/route.ts`
- Modify: `src/components/units/unit-files-panel.tsx`

### What the old action did
`uploadUnitFileAction` in `src/lib/server-actions/unit-files.ts`:
- Auth via `requireTeacherProfile()` (teacher/technician only)
- Accepts `unitId`, `file`
- Uploads to `units` bucket at `{unitId}/{fileName}`
- Returns `{ success: true }` or `{ success: false, error: string }`

### Component call site
```ts
// unit-files-panel.tsx lines ~67–71
const formData = new FormData()
formData.append("unitId", unitId)
formData.append("file", file)
const result = await uploadUnitFileAction(formData)
```

- [ ] **Step 1: Create the API route**

Create `src/app/api/unit-files/upload/route.ts`:

```ts
import { NextResponse } from "next/server"

import { getAuthenticatedProfile } from "@/lib/auth"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const UNIT_FILES_BUCKET = "units"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

function buildFilePath(unitId: string, fileName: string) {
  return `${unitId}/${fileName}`
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[unit-files-upload:${requestId}]`
  const startedAt = Date.now()

  console.log(`${tag} Request received`)

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    console.warn(`${tag} Rejected: unauthenticated`)
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  // Teacher/technician only
  const role = (profile as any).role ?? null
  if (role !== "teacher" && role !== "technician") {
    console.warn(`${tag} Rejected: insufficient role`, { userId: profile.userId, role })
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error(`${tag} Failed to parse form data`, err)
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 })
  }

  const unitId = formData.get("unitId")
  const file = formData.get("file")

  if (typeof unitId !== "string" || unitId.trim() === "") {
    return NextResponse.json({ success: false, error: "Missing unitId" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    console.warn(`${tag} File too large: ${file.size} bytes`, { fileName: file.name })
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit" }, { status: 413 })
  }

  const fileName = file.name
  const fullPath = buildFilePath(unitId, fileName)

  console.log(`${tag} Uploading`, { fileName, fileSize: file.size, unitId })

  const storage = createLocalStorageClient(UNIT_FILES_BUCKET)
  const arrayBuffer = await file.arrayBuffer()
  const { error } = await storage.upload(fullPath, arrayBuffer, {
    contentType: file.type || "application/octet-stream",
    originalPath: fullPath,
  })

  if (error) {
    console.error(`${tag} Storage upload failed`, { fullPath, error: error.message })
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  console.log(`${tag} Complete`, { fullPath, totalMs: Date.now() - startedAt })
  return NextResponse.json({ success: true })
}
```

Note on role check: `getAuthenticatedProfile()` returns the full profile including role. The `(profile as any).role` cast is safe here — check the actual shape returned by `getAuthenticatedProfile` in `src/lib/auth.ts` and adjust the property access if needed. Alternatively use `requireTeacherProfile` from `@/lib/auth` and catch the thrown error.

- [ ] **Step 2: Update unit-files-panel.tsx**

Remove `uploadUnitFileAction` from the import. Replace the call site:

```ts
// Before
const result = await uploadUnitFileAction(formData)

// After
let result: { success: boolean; error?: string }
try {
  const response = await fetch("/api/unit-files/upload", { method: "POST", body: formData })
  result = await response.json()
} catch (err) {
  console.error("[unit-files] Network error during upload", err)
  result = { success: false, error: "Network error, please try again." }
}
```

- [ ] **Step 3: Smoke test**

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3003/api/unit-files/upload \
  -F "unitId=test"
```
Expected: `401`

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit 2>&1 | grep -v "tests/"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/unit-files/ src/components/units/unit-files-panel.tsx
git commit -m "fix(upload): migrate unit file upload to API route"
```

---

## Task 6: Role check pattern for unit-files upload

This is a follow-up note to Task 5. The `uploadUnitFileAction` used `requireTeacherProfile()` which throws on failure. The API route needs to handle this cleanly. After creating the route in Task 5, verify how `getAuthenticatedProfile` exposes the role by reading `src/lib/auth.ts` and adjust the role check accordingly.

If `getAuthenticatedProfile` does not return role, switch to:

```ts
import { requireTeacherProfile } from "@/lib/auth"

// Replace the profile + role check block with:
try {
  await requireTeacherProfile()
} catch {
  console.warn(`${tag} Rejected: not a teacher`)
  return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
}
```

This is the same pattern `uploadUnitFileAction` uses internally.

- [ ] **Step 1: Read auth.ts to confirm role shape**

```bash
grep -n "requireTeacherProfile\|getAuthenticatedProfile\|role" /Users/leroysalih/nodejs/planner-004/src/lib/auth.ts | head -30
```

- [ ] **Step 2: Adjust role guard in unit-files route if needed**

If `getAuthenticatedProfile` does not return role, update `src/app/api/unit-files/upload/route.ts` to use `requireTeacherProfile` from `@/lib/auth` as shown above and remove the `(profile as any).role` check.

- [ ] **Step 3: Type-check and commit if changed**

```bash
pnpm tsc --noEmit 2>&1 | grep -v "tests/"
git add src/app/api/unit-files/
git commit -m "fix(upload): correct role guard in unit-files upload route"
```
