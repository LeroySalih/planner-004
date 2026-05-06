# Duplicate File Archive Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the `stored_files_bucket_scope_name_idx` unique constraint violation that occurs when a pupil re-uploads a file with the same name concurrently or within the same second.

**Architecture:** Three complementary layers of defence — millisecond precision in the archive timestamp eliminates same-second collisions, a caught constraint error in the storage layer handles any collision that slips through, and a ref guard on the client prevents the double-submit that triggers concurrent requests in the first place.

**Tech Stack:** Next.js 15 (App Router), React 19 `useTransition`, TypeScript, PostgreSQL (`pg` library), Tailwind CSS.

---

## Root Cause (read before touching code)

When a pupil uploads `image.jpg` and already has an `image.jpg` on record, the server action:

1. **Uploads** the new bytes — overwrites the `stored_files` row for `image.jpg` via `ON CONFLICT DO UPDATE`.
2. **Reads** the existing submission body and finds `image.jpg` in `uploaded_files`.
3. **Archives** the old record by calling `storage.move(image.jpg → image_<timestamp>.jpg)`.

If two requests arrive within the same wall-clock second (double-tap or rapid re-upload), both compute the **same archive name** (`image_DD-MM-YYYY_HH-mm-ss.jpg`). The first request's `UPDATE stored_files SET file_name = '<archive>'` succeeds; the second hits the unique index on `(bucket, scope_path, file_name)` and throws `code: '23505'`.

---

## Files touched

| File | Change |
|------|--------|
| `src/lib/server-actions/lesson-activity-files.ts` | Add millisecond component to archive timestamp |
| `src/lib/storage/local-storage.ts` | Catch `23505` in `moveFile`, delete source row as recovery |
| `src/components/pupil/pupil-upload-activity.tsx` | Add `uploadInProgress` ref guard; check it in `handleFileChange` and `beginUpload` |

---

## Task 1: Add millisecond precision to the archive timestamp

**Why:** Two concurrent requests arriving within the same second generate identical archive names. Adding milliseconds reduces the collision window to <1 ms — effectively impossible under normal conditions.

**Files:**
- Modify: `src/lib/server-actions/lesson-activity-files.ts` (lines 609–615)

- [ ] **Step 1: Locate the timestamp block**

Open `src/lib/server-actions/lesson-activity-files.ts`. Find this block (around line 609):

```typescript
const pad = (n: number) => n.toString().padStart(2, "0");
const now = new Date();
const timestamp = `${pad(now.getDate())}-${
  pad(now.getMonth() + 1)
}-${now.getFullYear()}_${pad(now.getHours())}-${
  pad(now.getMinutes())
}-${pad(now.getSeconds())}`;
```

- [ ] **Step 2: Replace with millisecond-precision timestamp**

```typescript
const pad = (n: number) => n.toString().padStart(2, "0");
const now = new Date();
// Include milliseconds so that two concurrent uploads within the same second
// produce different archive names, preventing a unique-constraint collision on
// stored_files_bucket_scope_name_idx.
const timestamp = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${now.getMilliseconds().toString().padStart(3, "0")}`;
```

- [ ] **Step 3: Verify the shape of `versionedName` is unchanged**

The lines that build `versionedName` from `timestamp` (lines 617–622) do not need to change — they interpolate the `timestamp` string directly. Confirm they still read:

```typescript
const dotIndex = oldFile.name.lastIndexOf(".");
const versionedName = dotIndex === -1
  ? `${oldFile.name}_${timestamp}`
  : `${oldFile.name.slice(0, dotIndex)}_${timestamp}${oldFile.name.slice(dotIndex)}`;
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/server-actions/lesson-activity-files.ts
git commit -m "fix(uploads): add millisecond precision to file archive timestamp

Prevents same-second concurrent uploads from generating identical archive
names, which caused a unique constraint violation on stored_files_bucket_scope_name_idx."
```

---

## Task 2: Make `moveFile` resilient to unique constraint violations

**Why:** Even with millisecond timestamps, a race between the upload upsert (step 1) and the move (step 3) can leave the storage layer in a state where the target name already exists. This layer should be a silent safety net — not a source of unhandled errors.

**Recovery strategy:** If the UPDATE hits a `23505` unique constraint error, the target archive name already exists (a concurrent request won). The source row's file on disk has already been replaced by the new upload. Safe action: delete the source row.

**Files:**
- Modify: `src/lib/storage/local-storage.ts` (lines 259–269)

- [ ] **Step 1: Locate the UPDATE query in `moveFile`**

Open `src/lib/storage/local-storage.ts`. Find the `moveFile` function (line 226). The query to change is around line 259:

```typescript
await query(
  `
    update stored_files
    set scope_path = $1,
        file_name = $2,
        stored_path = $3,
        updated_at = timezone('utc', now())
    where id = $4
  `,
  [toScope, toName, targetRelative, row.id],
)
```

- [ ] **Step 2: Wrap the UPDATE to handle unique constraint conflicts**

Replace the bare `await query(...)` with this try/catch block:

```typescript
try {
  await query(
    `
      update stored_files
      set scope_path = $1,
          file_name = $2,
          stored_path = $3,
          updated_at = timezone('utc', now())
      where id = $4
    `,
    [toScope, toName, targetRelative, row.id],
  )
} catch (err: any) {
  if (err?.code === "23505") {
    // A concurrent request already archived this file under the same name.
    // The disk file has already been replaced by the new upload, so the source
    // DB row is now stale. Delete it to keep stored_files consistent.
    await query(`delete from stored_files where id = $1`, [row.id])
    console.warn("[storage] Duplicate archive name detected — source row removed", {
      bucket,
      fromPath,
      toPath,
    })
  } else {
    throw err
  }
}
```

- [ ] **Step 3: Verify the outer catch still works**

The `moveFile` function already has a top-level `catch (error)` (line 272) that logs and returns `{ error: { message: "Unable to move file" } }`. The re-thrown error in the `else` branch above will be caught by it — confirm this is correct by tracing the control flow. No change to the outer catch is needed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/storage/local-storage.ts
git commit -m "fix(storage): recover gracefully from duplicate archive name constraint

When moveFile hits a unique constraint on the target name (23505), a concurrent
request already archived the file. Delete the now-stale source row so
stored_files remains consistent instead of surfacing an unhandled error."
```

---

## Task 3: Prevent double-submit on the client

**Why:** The most common trigger for concurrent uploads is a rapid double-tap on the upload button or drop zone. `useTransition` sets `isPending = true` once the async work is scheduled, but `handleFileChange` (the `<input onChange>` handler) doesn't consult `isPending`, so a second file-picker selection can fire a second upload before React re-renders with `isPending = true`.

**Fix:** Add an `uploadInProgress` ref that is set synchronously at the start of `beginUpload` and cleared in `finally`. Check it at the top of `beginUpload` and in `handleFileChange`.

**Files:**
- Modify: `src/components/pupil/pupil-upload-activity.tsx`

- [ ] **Step 1: Add the `uploadInProgress` ref**

Find the existing refs/state declarations (around line 82–89):

```typescript
const [isPending, startTransition] = useTransition()
const [submissions, setSubmissions] = useState<ActivityFileInfo[]>(...)
const [statusPendingPath, setStatusPendingPath] = useState<string | null>(null)
const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
const [isDragActive, setIsDragActive] = useState(false)
const fileInputRef = useRef<HTMLInputElement | null>(null)
```

Add the new ref directly below `fileInputRef`:

```typescript
const fileInputRef = useRef<HTMLInputElement | null>(null)
// Guards against concurrent uploads caused by rapid double-tap or duplicate
// onChange events. useTransition's isPending is not synchronous enough to
// block a second call before React re-renders with isPending = true.
const uploadInProgress = useRef(false)
```

- [ ] **Step 2: Guard `beginUpload` with the ref**

Find the `beginUpload` callback (line 128). Add a guard at the very top and set/clear the ref around `startTransition`:

```typescript
const beginUpload = useCallback(
  (incoming: FileList | File[]) => {
    // Synchronous guard: prevent a second upload starting before React
    // re-renders with isPending = true (e.g. rapid double-tap or duplicate
    // onChange events from the file input).
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
        setSelectedFileName(file.name)

        const formData = new FormData()
        formData.append("lessonId", lessonId)
        formData.append("activityId", activity.activity_id)
        formData.append("pupilId", pupilId)
        formData.append("file", file)

        const result = await uploadPupilActivitySubmissionAction(formData)
        if (!result.success) {
          toast.error(`Upload failed for ${file.name}`, {
            description: result.error ?? "Please try again later.",
          })
          setSelectedFileName(null)
          return
        }

        toast.success(`Uploaded ${file.name}`)

        const optimisticEntry: ActivityFileInfo = {
          name: file.name,
          path: `${lessonId}/activities/${activity.activity_id}/${pupilId}/${file.name}`,
          size: file.size,
          status: "inprogress",
          submissionId: null,
          submittedAt: new Date().toISOString(),
        }

        setSubmissions([optimisticEntry])
        onSubmissionsChange?.([optimisticEntry])

        setSelectedFileName(null)
        await refreshSubmissions()
      } finally {
        uploadInProgress.current = false
      }
    })
  },
  [activity.activity_id, lessonId, onSubmissionsChange, pupilId, refreshSubmissions, startTransition, submissions],
)
```

- [ ] **Step 3: Add `isPending` check to `handleFileChange`**

Find `handleFileChange` (line 187). Add a guard against `isPending` as a belt-and-braces check alongside the ref:

```typescript
const handleFileChange = useCallback(
  (event: ChangeEvent<HTMLInputElement>) => {
    // Prevent duplicate uploads if the input somehow fires twice (mobile browsers,
    // rapid re-selection). The ref guard in beginUpload is the primary protection;
    // this is a secondary check.
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
```

- [ ] **Step 4: Verify `uploadDisabled` still covers the drop zone and button**

Confirm that line 94 still reads:

```typescript
const uploadDisabled = !canUpload || isPending
```

And that both the drop zone `onClick` and the "Choose file" `Button` check `uploadDisabled` before acting. No changes needed here — they already guard correctly. The ref guard in `beginUpload` is the new addition for the `onChange` path.

- [ ] **Step 5: Commit**

```bash
git add src/components/pupil/pupil-upload-activity.tsx
git commit -m "fix(pupil-upload): prevent double-submit with synchronous ref guard

useTransition's isPending is not set synchronously, so a rapid double-tap
or duplicate onChange event could start two concurrent uploads. The new
uploadInProgress ref blocks the second call immediately, before React
re-renders."
```

---

## Self-Review

**Spec coverage:**
- ✅ Millisecond timestamp — Task 1
- ✅ `ON CONFLICT`-equivalent recovery in `moveFile` — Task 2
- ✅ Client double-submit prevention — Task 3
- ✅ Comments capturing the reason for each change — all tasks include inline comments explaining the why

**Placeholder scan:** No TBDs, no vague "handle edge cases" steps. All code is complete.

**Type consistency:** `uploadInProgress` is `useRef<boolean>(false)` — implicit from `useRef(false)`, no explicit type annotation needed. `err?.code` is `string | undefined`, checked against `"23505"` — consistent with how other pg error codes are checked in the codebase.

**No unit test infrastructure exists** — this project uses Playwright E2E only. Manual verification: upload the same file twice in rapid succession on the pupil lesson page and confirm no errors appear in docker logs.
