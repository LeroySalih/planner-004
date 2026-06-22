# Upload Spreadsheet Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new scorable `upload-spreadsheet` activity type where pupils upload an `.xlsx` in response to a teacher's task, and the file + task are auto-marked by the existing n8n AI marking pipeline.

**Architecture:** Reuse the `short-text-question` AI-marking pipeline (`ai_marking_queue` → `invokeAiMarking()` → n8n → `/webhooks/ai-mark` callback) and the `upload-file` local-storage upload pattern. The marking queue processor is generalized to branch on activity type; a new parser module extracts cell values/formulas from the uploaded `.xlsx` using the already-installed `exceljs` dependency.

**Tech Stack:** Next.js 15 App Router, TypeScript, Zod, PostgreSQL (`pg`), `exceljs` (already a dependency, `^4.4.0`).

**Spec:** `docs/superpowers/specs/2026-06-22-upload-spreadsheet-activity-design.md`

---

## Task 1: Register the activity type and body schemas

**Files:**
- Modify: `src/dino.config.ts:1-13`
- Modify: `src/types/index.ts` (add after line 563, immediately following `ShortTextSubmissionBody` type export)
- Test: `src/types/upload-spreadsheet.test.ts` (new)

- [ ] **Step 1: Add `upload-spreadsheet` to `SCORABLE_ACTIVITY_TYPES`**

In `src/dino.config.ts`, change:

```ts
export const SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "multiple-choice-question",
  "short-text-question",
  "text-question",
  "long-text-question",
  "upload-file",
  "upload-url",
  "feedback",
  "sketch-render",
  "do-flashcards",
  "matcher",
  "group-items",
]);
```

to:

```ts
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

- [ ] **Step 2: Write the failing schema test**

Create `src/types/upload-spreadsheet.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  UploadSpreadsheetActivityBodySchema,
  UploadSpreadsheetSubmissionBodySchema,
} from "@/types";

describe("UploadSpreadsheetActivityBodySchema", () => {
  it("requires non-empty task and markingGuidance", () => {
    expect(() =>
      UploadSpreadsheetActivityBodySchema.parse({ task: "", markingGuidance: "x" }),
    ).toThrow();
    expect(() =>
      UploadSpreadsheetActivityBodySchema.parse({ task: "x", markingGuidance: "" }),
    ).toThrow();
  });

  it("accepts valid task and markingGuidance", () => {
    const parsed = UploadSpreadsheetActivityBodySchema.parse({
      task: "Build a budget spreadsheet",
      markingGuidance: "Check totals use SUM formulas",
    });
    expect(parsed.task).toBe("Build a budget spreadsheet");
  });
});

describe("UploadSpreadsheetSubmissionBodySchema", () => {
  it("defaults score/feedback fields to null and is_correct to false", () => {
    const parsed = UploadSpreadsheetSubmissionBodySchema.parse({
      filePath: "lessons/l1/activities/a1/p1/sheet.xlsx",
      fileName: "sheet.xlsx",
    });
    expect(parsed.ai_model_score ?? null).toBeNull();
    expect(parsed.is_correct).toBe(false);
    expect(parsed.success_criteria_scores).toEqual({});
  });

  it("requires filePath and fileName", () => {
    expect(() => UploadSpreadsheetSubmissionBodySchema.parse({})).toThrow();
  });
});
```

> Note: if this project does not use `vitest`, check `package.json` `scripts.test` — this repo has "No unit test infrastructure yet" per `CLAUDE.md`. If no unit test runner exists, skip Steps 2 and 4 (the `pnpm vitest` commands) and instead verify these schemas via a throwaway `tsx` script in Step 3b below. Check `package.json` for a `vitest`/`jest` devDependency before running Step 2.

- [ ] **Step 3: Run test to verify it fails (schema doesn't exist yet)**

Run: `npx vitest run src/types/upload-spreadsheet.test.ts`
Expected: FAIL with "UploadSpreadsheetActivityBodySchema is not exported" or similar import error.

If no test runner is configured, instead run:

```bash
npx tsx -e "
import { UploadSpreadsheetActivityBodySchema } from './src/types';
console.log(UploadSpreadsheetActivityBodySchema);
"
```
Expected: FAIL with a TypeScript/import error.

- [ ] **Step 4: Add the schemas**

In `src/types/index.ts`, immediately after line 563 (`export type ShortTextSubmissionBody = z.infer<typeof ShortTextSubmissionBodySchema>;`), add:

```ts
export const UploadSpreadsheetActivityBodySchema = z
    .object({
        task: z.string().min(1),
        markingGuidance: z.string().min(1),
    })
    .passthrough();

export const UploadSpreadsheetSubmissionBodySchema = z
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

export type UploadSpreadsheetActivityBody = z.infer<
    typeof UploadSpreadsheetActivityBodySchema
>;
export type UploadSpreadsheetSubmissionBody = z.infer<
    typeof UploadSpreadsheetSubmissionBodySchema
>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/types/upload-spreadsheet.test.ts` (or the `tsx` script from Step 3 — it should now print the schema object with no error)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/dino.config.ts src/types/index.ts src/types/upload-spreadsheet.test.ts
git commit -m "feat: add upload-spreadsheet activity type and body schemas"
```

---

## Task 2: Spreadsheet parsing module

**Files:**
- Create: `src/lib/spreadsheet/parse-xlsx.ts`
- Test: `src/lib/spreadsheet/parse-xlsx.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/spreadsheet/parse-xlsx.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseSpreadsheet } from "./parse-xlsx";

async function buildTestWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "Item";
  sheet.getCell("B1").value = "Cost";
  sheet.getCell("A2").value = "Pencil";
  sheet.getCell("B2").value = 2;
  sheet.getCell("A3").value = "Total";
  sheet.getCell("B3").value = { formula: "SUM(B2:B2)", result: 2 };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("parseSpreadsheet", () => {
  it("extracts plain values and formula+result pairs per sheet", async () => {
    const buffer = await buildTestWorkbook();
    const sheets = await parseSpreadsheet(buffer);

    expect(sheets).toHaveLength(1);
    expect(sheets[0].sheetName).toBe("Sheet1");

    const rows = sheets[0].rows;
    expect(rows[0][0]).toEqual({ value: "Item" });
    expect(rows[1][1]).toEqual({ value: 2 });
    expect(rows[2][1]).toMatchObject({ formula: "SUM(B2:B2)", result: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spreadsheet/parse-xlsx.test.ts`
Expected: FAIL with "Cannot find module './parse-xlsx'"

- [ ] **Step 3: Implement `parseSpreadsheet`**

Create `src/lib/spreadsheet/parse-xlsx.ts`:

```ts
import ExcelJS from "exceljs";

export type ParsedCell = {
  value: string | number | boolean | null;
  formula?: string;
  result?: string | number | boolean | null;
};

export type ParsedSheet = {
  sheetName: string;
  rows: ParsedCell[][];
};

function toScalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  // Rich text / hyperlink objects: fall back to their text representation.
  if (typeof value === "object" && "text" in (value as Record<string, unknown>)) {
    return String((value as { text: unknown }).text);
  }
  return String(value);
}

export async function parseSpreadsheet(buffer: Buffer): Promise<ParsedSheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets: ParsedSheet[] = [];

  workbook.eachSheet((worksheet) => {
    const rows: ParsedCell[][] = [];

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: ParsedCell[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const raw = cell.value;
        if (
          raw !== null &&
          typeof raw === "object" &&
          "formula" in (raw as Record<string, unknown>)
        ) {
          const formulaValue = raw as { formula: string; result?: unknown };
          cells.push({
            value: toScalar(formulaValue.result),
            formula: formulaValue.formula,
            result: toScalar(formulaValue.result),
          });
        } else {
          cells.push({ value: toScalar(raw) });
        }
      });
      rows.push(cells);
    });

    sheets.push({ sheetName: worksheet.name, rows });
  });

  return sheets;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spreadsheet/parse-xlsx.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/spreadsheet/parse-xlsx.ts src/lib/spreadsheet/parse-xlsx.test.ts
git commit -m "feat: add xlsx cell/formula parser for spreadsheet marking"
```

---

## Task 3: Upload API route for spreadsheet submissions

**Files:**
- Create: `src/app/api/pupil-submission/upload-spreadsheet/route.ts`

This is a dedicated route (not a branch inside the existing `/api/pupil-submission/upload/route.ts`) so the well-tested `upload-file` flow is untouched, and because this route's validation (`.xlsx`-only) and submission body shape (`UploadSpreadsheetSubmissionBodySchema`) differ from `upload-file`'s.

- [ ] **Step 1: Implement the route**

Create `src/app/api/pupil-submission/upload-spreadsheet/route.ts`:

```ts
import { NextResponse } from "next/server"
import { Client } from "pg"

import { getAuthenticatedProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { logActivitySubmissionEvent } from "@/lib/activity-logging"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import { UploadSpreadsheetSubmissionBodySchema } from "@/types"

const LESSON_FILES_BUCKET = "lessons"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_EXTENSION = ".xlsx"
const ALLOWED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
  const tag = `[pupil-upload-spreadsheet:${requestId}]`

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
  const hasXlsxExtension = fileName.toLowerCase().endsWith(ALLOWED_EXTENSION)
  const hasAllowedMime = file.type === "" || ALLOWED_MIME_TYPES.has(file.type)
  if (!hasXlsxExtension || !hasAllowedMime) {
    return NextResponse.json({ success: false, error: "Only .xlsx files are allowed" }, { status: 415 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ success: false, error: "File exceeds 5MB limit" }, { status: 413 })
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

  // Replace-on-reupload: always write to the same path (no versioning) so the
  // submission's filePath always points at the current file.
  const { error: uploadError } = await storage.upload(path, arrayBuffer, {
    contentType: file.type || ALLOWED_MIME_TYPES.values().next().value!,
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

      const submissionBody = UploadSpreadsheetSubmissionBodySchema.parse({
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
    await emitSubmissionEvent("submission.uploaded", {
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
  if (submissionId) {
    try {
      const { rows: assignmentRows } = await query<{ group_assignment_id: string }>(
        `
          select ga.group_assignment_id
          from group_assignments ga
          join lessons l on l.lesson_id = ga.lesson_id
          where l.lesson_id = $1
          limit 1
        `,
        [lessonId],
      )
      const assignmentId = assignmentRows[0]?.group_assignment_id ?? lessonId
      await enqueueMarkingTasks(assignmentId, [{ submissionId }])
      await triggerQueueProcessor()
    } catch (err) {
      console.error(`${tag} Failed to enqueue AI marking (non-fatal)`, err)
    }
  }

  console.log(`${tag} Upload complete`, { submissionId, fileName, lessonId, activityId, pupilId, durationMs: Date.now() - startedAt })

  return NextResponse.json({ success: true, submissionId })
}
```

> Note: the `group_assignment_id` lookup query assumes a `group_assignments` table keyed by `lesson_id` — confirm the exact join against how `short-text.ts`'s `saveShortTextAnswerAction` resolves `assignmentId` for `enqueueMarkingTasks`, and match that exact lookup here instead if it differs. Read `src/lib/server-actions/short-text.ts:84-196` before writing this step and copy its assignment-id resolution verbatim.

- [ ] **Step 2: Manual verification (no automated test — this is an HTTP route exercising real file storage and DB)**

Start the dev server (`pnpm dev`), sign in as a pupil with an assignment containing an `upload-spreadsheet` activity (created once Task 6 below exists), and upload a small `.xlsx`. Confirm:
- A row appears in `submissions` with `submission_status = 'submitted'` and `body.filePath` pointing at a file that exists under `./files/lessons/...`.
- A row appears in `ai_marking_queue` with `status = 'pending'`.

(This step is deferred until Task 6 wires up the teacher/pupil UI — note it here, execute it after Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/pupil-submission/upload-spreadsheet/route.ts
git commit -m "feat: add upload route for spreadsheet submissions with auto-marking enqueue"
```

---

## Task 4: Generalize the marking queue processor

**Files:**
- Modify: `src/lib/ai/marking-queue.ts:126-244` (`processSingleItem`)
- Modify: `src/lib/ai/ai-marking-client.ts` (`AiMarkingParams`)

The current `processSingleItem` (lines 185-232) hardcodes a guard for `context.type !== "short-text-question"` and builds a short-text-only `doParams`. This task generalizes it to branch on activity type while keeping the short-text path byte-for-byte identical.

- [ ] **Step 1: Extend `AiMarkingParams` to cover the spreadsheet payload**

In `src/lib/ai/ai-marking-client.ts`, replace the existing interface:

```ts
export interface AiMarkingParams {
  question: string;
  model_answer: string;
  pupil_answer: string;
  // Callback and context for async processing
  webhook_url?: string;
  group_assignment_id?: string;
  activity_id?: string;
  pupil_id?: string;
  submission_id?: string;
}
```

with:

```ts
export interface ShortTextMarkingParams {
  question: string;
  model_answer: string;
  pupil_answer: string;
  webhook_url?: string;
  group_assignment_id?: string;
  activity_id?: string;
  pupil_id?: string;
  submission_id?: string;
}

export interface SpreadsheetCell {
  value: string | number | boolean | null;
  formula?: string;
  result?: string | number | boolean | null;
}

export interface SpreadsheetMarkingParams {
  task: string;
  marking_guidance: string;
  spreadsheet_base64: string;
  spreadsheet_data: Array<{ sheetName: string; rows: SpreadsheetCell[][] }>;
  webhook_url?: string;
  group_assignment_id?: string;
  activity_id?: string;
  pupil_id?: string;
  submission_id?: string;
}

export type AiMarkingParams = ShortTextMarkingParams | SpreadsheetMarkingParams;
```

`invokeAiMarking()` itself (lines 19-49) needs no change — it already just JSON-stringifies whatever `params` object it's given and POSTs it.

- [ ] **Step 2: Branch `processSingleItem` on activity type**

In `src/lib/ai/marking-queue.ts`, the imports at the top currently are:

```ts
import { query, withDbClient } from "@/lib/db";
import {
  ShortTextActivityBodySchema,
  ShortTextSubmissionBodySchema,
} from "@/types";
import { invokeAiMarking } from "./ai-marking-client";
```

Change to:

```ts
import { query, withDbClient } from "@/lib/db";
import {
  ShortTextActivityBodySchema,
  ShortTextSubmissionBodySchema,
  UploadSpreadsheetActivityBodySchema,
  UploadSpreadsheetSubmissionBodySchema,
} from "@/types";
import { invokeAiMarking } from "./ai-marking-client";
import { parseSpreadsheet } from "@/lib/spreadsheet/parse-xlsx";
import { createLocalStorageClient } from "@/lib/storage/local-storage";
```

Replace the guard-and-build block (originally lines 185-232: from `// Guard: Only process short-text questions` through the `await invokeAiMarking(doParams);` call) with:

```ts
    const SUPPORTED_TYPES = new Set(["short-text-question", "upload-spreadsheet"]);
    if (!SUPPORTED_TYPES.has(context.type)) {
      await logQueueEvent(
        "warn",
        `Skipping unsupported activity type ${context.activity_id}`,
        { type: context.type },
      );

      // Mark as completed so we don't retry
      await query(
        `UPDATE ai_marking_queue SET status = 'completed', updated_at = now() WHERE queue_id = $1`,
        [item.queue_id],
      );
      return;
    }

    // 3. Trigger DO function
    let effectiveCallbackUrl: string | undefined;

    if (callbackUrl) {
      // Normalize base URL (remove trailing slash)
      const normalizedBase = callbackUrl.replace(/\/$/, "");

      if (item.assignment_id === "revision") {
        effectiveCallbackUrl = `${normalizedBase}/webhooks/ai-mark-revision`;
      } else {
        effectiveCallbackUrl = `${normalizedBase}/webhooks/ai-mark`;
      }
    }

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
    } else {
      const parsedActivity = UploadSpreadsheetActivityBodySchema.parse(
        context.activity_body,
      );
      const parsedSubmission = UploadSpreadsheetSubmissionBodySchema.parse(
        context.submission_body,
      );

      const storage = createLocalStorageClient("lessons");
      const { data: fileBuffer, error: downloadError } = await storage.download(
        parsedSubmission.filePath,
      );
      if (downloadError || !fileBuffer) {
        throw new Error(
          `Failed to read spreadsheet file at ${parsedSubmission.filePath}: ${downloadError?.message ?? "no data"}`,
        );
      }

      const buffer = Buffer.from(fileBuffer);
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
    }
```

> Note: confirm `createLocalStorageClient(...)` exposes a `.download(path)` method returning `{ data, error }` — read `src/lib/storage/local-storage.ts:140-343` before writing this step. If the actual method name differs (e.g. `.read` or `.get`), use the real name; do not guess at runtime.

- [ ] **Step 3: Manual verification**

Run the existing short-text-question marking flow end-to-end (or, if a test exists, run it) to confirm the refactor didn't change short-text behavior:

Run: `npx vitest run` (or whatever the project's existing test command is — check `package.json` `scripts.test`; this repo's primary test suite is Playwright E2E per `CLAUDE.md`, so this may instead mean manually triggering a short-text submission in the dev UI and confirming it still gets marked).

Expected: short-text marking still completes and writes `ai_model_score`/`ai_model_feedback` as before.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/marking-queue.ts src/lib/ai/ai-marking-client.ts
git commit -m "feat: generalize marking queue processor to handle upload-spreadsheet"
```

---

## Task 5: Accept `upload-spreadsheet` in the AI-mark webhook

**Files:**
- Modify: `src/app/webhooks/ai-mark/route.ts:21` and `:208-223`

The webhook currently only accepts results for `SHORT_TEXT_ACTIVITY_TYPE`. This task widens that allowlist. The actual score/feedback-writing logic further down (`applyAiMarkToSubmission`, lines ~307-330 and ~532-599) must be checked for any `ShortTextSubmissionBodySchema`-specific parsing — if found, branch it the same way Task 4 branched `processSingleItem`.

- [ ] **Step 1: Read the full webhook route before editing**

Read `src/app/webhooks/ai-mark/route.ts` in full (it's 648 lines) and specifically inspect `applyAiMarkToSubmission` and the "create new submission" branch (~lines 307-330, ~532-599) for any place that parses or constructs a submission body using `ShortTextSubmissionBodySchema` by name. List every such call site before making changes.

- [ ] **Step 2: Widen the activity-type constant and guard**

Replace:

```ts
const SHORT_TEXT_ACTIVITY_TYPE = "short-text-question";
```

with:

```ts
const SHORT_TEXT_ACTIVITY_TYPE = "short-text-question";
const UPLOAD_SPREADSHEET_ACTIVITY_TYPE = "upload-spreadsheet";
const AI_MARKABLE_ACTIVITY_TYPES = new Set([
  SHORT_TEXT_ACTIVITY_TYPE,
  UPLOAD_SPREADSHEET_ACTIVITY_TYPE,
]);
```

Replace:

```ts
  if ((activityRow.type ?? "").trim() !== SHORT_TEXT_ACTIVITY_TYPE) {
```

with:

```ts
  if (!AI_MARKABLE_ACTIVITY_TYPES.has((activityRow.type ?? "").trim())) {
```

- [ ] **Step 3: Branch any `ShortTextSubmissionBodySchema`-specific parsing found in Step 1**

For each call site found in Step 1, parse against `ShortTextSubmissionBodySchema` when `activityRow.type === SHORT_TEXT_ACTIVITY_TYPE`, and against `UploadSpreadsheetSubmissionBodySchema` (imported from `@/types`) when `activityRow.type === UPLOAD_SPREADSHEET_ACTIVITY_TYPE`. Both schemas share the same `ai_model_score` / `ai_model_feedback` / `teacher_override_score` / `is_correct` / `teacher_feedback` / `success_criteria_scores` fields, so the score-writing logic itself should not need branching — only the schema used to validate/merge the existing body before writing back.

- [ ] **Step 4: Manual verification**

With the dev server running, manually POST a synthetic payload to `/webhooks/ai-mark` (using the `mark-service-key` header from `.env`) for an `upload-spreadsheet` activity's submission, and confirm the submission's `ai_model_score`/`ai_model_feedback` get written, and the realtime SSE event fires (check browser dev tools / teacher dashboard).

Example:

```bash
curl -X POST http://localhost:3000/webhooks/ai-mark \
  -H "Content-Type: application/json" \
  -H "mark-service-key: $MARK_SERVICE_KEY" \
  -d '{
    "group_assignment_id": "<real-assignment-id>",
    "activity_id": "<real-upload-spreadsheet-activity-id>",
    "results": [{ "pupil_id": "<real-pupil-id>", "score": 0.75, "feedback": "Good use of SUM formula." }]
  }'
```

Expected: `{"success": true, "updated": 1, ...}` and the submission row's `body.ai_model_score` becomes `0.75`.

- [ ] **Step 5: Commit**

```bash
git add src/app/webhooks/ai-mark/route.ts
git commit -m "feat: accept upload-spreadsheet submissions in ai-mark webhook"
```

---

## Task 6: Teacher editor UI

**Files:**
- Modify: `src/components/lessons/lesson-activities-manager.tsx`

- [ ] **Step 1: Read the short-text-question editor section in full**

Read `src/components/lessons/lesson-activities-manager.tsx` lines 1790-2200 in full (the short-text editor state, `validateShortTextBody()`, and the save/submit wiring) before writing this task's code, since the exact state-management and save-handler wiring must be matched precisely — paraphrasing this section without reading it risks missing how the activity editor sheet dispatches `body_data` to the save action.

- [ ] **Step 2: Add `upload-spreadsheet` to the type selector**

In the `ACTIVITY_TYPES` array (lines 83-104), add a new entry (placed next to `upload-file`/`upload-url` for discoverability):

```ts
  { value: "upload-file", label: "Upload file" },
  { value: "upload-url", label: "Upload URL" },
  { value: "upload-spreadsheet", label: "Upload spreadsheet" },
```

- [ ] **Step 3: Add editor state and form fields**

Following the exact pattern read in Step 1 (state shape, validation function naming, and how `shortTextBody` is wired into the save handler), add:

```ts
type UploadSpreadsheetBody = {
  task: string;
  markingGuidance: string;
};

const [uploadSpreadsheetBody, setUploadSpreadsheetBody] = useState<UploadSpreadsheetBody>({
  task: "",
  markingGuidance: "",
});

function validateUploadSpreadsheetBody(body: UploadSpreadsheetBody): string | null {
  if (!body.task.trim()) return "Task description is required.";
  if (!body.markingGuidance.trim()) return "Marking guidance is required.";
  return null;
}
```

Add a form section (rendered when the selected type is `upload-spreadsheet`) with two `RichTextEditor` fields — "Task" (bound to `uploadSpreadsheetBody.task`) and "Marking guidance" (bound to `uploadSpreadsheetBody.markingGuidance`), each calling `setUploadSpreadsheetBody` on change, mirroring the short-text question's question/model-answer field markup exactly (same component, same label/help-text styling).

Wire `uploadSpreadsheetBody` into the save/submit handler at the same point `shortTextBody` is wired in, gated on `validateUploadSpreadsheetBody` returning `null`, sending `{ task, markingGuidance }` as `body_data` for the `upload-spreadsheet` type.

- [ ] **Step 4: Manual verification**

Run `pnpm dev`, open a lesson as a teacher, add an activity, select "Upload spreadsheet" from the type dropdown, fill in both fields, save. Confirm the activity row's `body_data` in the DB (or via the lesson UI) contains `{ "task": "...", "markingGuidance": "..." }`.

- [ ] **Step 5: Commit**

```bash
git add src/components/lessons/lesson-activities-manager.tsx
git commit -m "feat: add teacher editor fields for upload-spreadsheet activity"
```

---

## Task 7: Pupil submission component

**Files:**
- Create: `src/components/pupil/pupil-upload-spreadsheet-activity.tsx`
- Modify: wherever pupil-side activity components are dispatched by `activity.type` (locate via `grep -rn "pupil-upload-activity" src/components` to find the parent dispatcher, since this wasn't captured precisely during research)

- [ ] **Step 1: Read the full `pupil-upload-activity.tsx` file**

Read `src/components/pupil/pupil-upload-activity.tsx` in full (549 lines) before writing this component — pay special attention to lines 130-198 (`beginUpload`), 200-218 (`handleFileChange` guards), 274-308 (`handleStatusChange`), and 343-363 (drag-drop handlers), since the new component reuses this exact upload/status/drag-drop structure.

- [ ] **Step 2: Find the pupil-side dispatcher**

Run: `grep -rln "PupilUploadActivity\|pupil-upload-activity" src/components src/app`

Identify the file that imports `pupil-upload-activity.tsx` and renders it conditionally on `activity.type === "upload-file"`. This is the dispatcher to extend in Step 4.

- [ ] **Step 3: Create the spreadsheet upload component**

Create `src/components/pupil/pupil-upload-spreadsheet-activity.tsx`, copying the structure of `pupil-upload-activity.tsx` with these changes:
- File input `accept` attribute set to `.xlsx`.
- Client-side validation rejects any file whose name doesn't end in `.xlsx` (case-insensitive) before upload begins, showing a `sonner` toast error matching the existing error-toast pattern in `pupil-upload-activity.tsx`.
- POSTs to `/api/pupil-submission/upload-spreadsheet` (the route from Task 3) instead of `/api/pupil-submission/upload`.
- Renders the activity's `task` (from `activity.body_data.task`) above the upload control instead of generic "upload" instructions.
- Re-upload is allowed at any time before the lesson/assignment lock (matching `upload-file`'s existing re-upload behavior found in Step 1) — do not add any one-shot lock logic.
- Once `ai_model_score`/`ai_model_feedback` are present on the submission, renders them below the upload control using the same score/feedback display markup as `pupil-short-text-activity.tsx`.

- [ ] **Step 4: Wire into the dispatcher**

In the file identified in Step 2, add an `activity.type === "upload-spreadsheet"` branch rendering `<PupilUploadSpreadsheetActivity ... />`, passing the same props the `upload-file` branch passes to `PupilUploadActivity` (adjust prop names only if the new component's prop signature differs).

- [ ] **Step 5: Manual verification**

`pnpm dev`, sign in as a pupil with an assignment containing the `upload-spreadsheet` activity created in Task 6. Confirm:
- The task text renders.
- Uploading a `.docx` is rejected client-side with an error toast.
- Uploading a valid `.xlsx` succeeds, and re-uploading a second `.xlsx` replaces it (check the `submissions.body.fileName` updates).
- After the AI marking webhook fires (Task 5), the score and feedback appear.

- [ ] **Step 6: Commit**

```bash
git add src/components/pupil/pupil-upload-spreadsheet-activity.tsx
git commit -m "feat: add pupil-facing upload-spreadsheet submission component"
```

---

## Task 8: Activity preview rendering (teacher/summary view)

**Files:**
- Modify: `src/components/lessons/activity-view/index.tsx:281-339` area

- [ ] **Step 1: Read the existing branches**

Read `src/components/lessons/activity-view/index.tsx` lines 176-451 in full to see the exact if/else chain structure, and specifically lines 281-288 (`upload-file`) and 317-330 (`short-text-question`) as the two closest patterns to combine.

- [ ] **Step 2: Add the `upload-spreadsheet` branch**

Add a new branch (placed next to the `upload-file` branch) that renders:
- The activity's `task` text (from `activity.body_data.task`), using the same text-rendering helper the `text`/`short-text-question` branches use.
- If a submission exists, the uploaded `fileName`.
- If `ai_model_score` is present, the score and feedback, using the same markup as the `short-text-question` branch.

Match the exact conditional structure (e.g. `else if (activity.type === "upload-spreadsheet") { ... }`) already used by neighboring branches — do not introduce a different control-flow style (e.g. a lookup object) since this file is an established if/else chain.

- [ ] **Step 3: Manual verification**

`pnpm dev`, view the lesson/activity summary as a teacher for an `upload-spreadsheet` activity with a marked submission. Confirm task, filename, score, and feedback all render correctly.

- [ ] **Step 4: Commit**

```bash
git add src/components/lessons/activity-view/index.tsx
git commit -m "feat: render upload-spreadsheet activity preview"
```

---

## Task 9: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full flow test**

1. As a teacher, create an `upload-spreadsheet` activity with a task and marking guidance.
2. As a pupil, view the activity, see the task text, upload a small `.xlsx` containing at least one formula (e.g. a `SUM`).
3. Confirm a row appears in `ai_marking_queue` with `status = 'pending'`, then (once the queue processor and n8n round-trip complete, or once manually invoked via `/api/marking/process-queue`) confirm it transitions and the submission gets `ai_model_score`/`ai_model_feedback`.
4. As the pupil, re-upload a different `.xlsx`. Confirm the old file is replaced (or versioned, matching `upload-file`'s existing behavior) and a new marking-queue row is enqueued.
5. As the teacher, view the marked submission in the activity summary (Task 8's UI) and confirm the score/feedback display.

- [ ] **Step 2: Run the project's lint/build checks**

Run: `pnpm lint`
Expected: no new errors introduced by this feature's files.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit any final fixups**

```bash
git add -A
git commit -m "fix: address lint/build issues from upload-spreadsheet feature"
```

(Only if fixups were needed — skip this commit if Step 2 was clean.)
