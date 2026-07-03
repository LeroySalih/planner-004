/**
 * E2E test: Worksheet OCR → edit → mark flow
 *
 * ENVIRONMENT BLOCKER (not a code bug)
 * ------------------------------------
 * This spec CANNOT run against a DB cloned from production because production
 * password hashes differ from any known test password. The accounts
 * `leroysalih@bisak.org` and `p1@bisak.org` exist in the DB but their
 * bcrypt hashes do NOT match "password" or "bisak123".
 *
 * To make this spec runnable, seed the worktree DB with known-password accounts:
 *
 *   PGPASSWORD=... psql -U postgres -h localhost -p 5433 -d postgres-exam-question-ocr -c \
 *     "UPDATE profiles SET password_hash = '\$2b\$10\$8d6pphvMCMKlYXPklQs6iuZgq8MIHJYBPK3l9c5czgpLTsdBMxnmW' \
 *      WHERE email IN ('leroysalih@bisak.org','p1@bisak.org');"
 *   # The hash above is the table default and corresponds to the password "bisak123"
 *
 * Additionally the DB must contain:
 *   - A lesson with an `upload-worksheet` activity and a group_assignment linked
 *     to both the teacher and pupil accounts so marking can be enqueued.
 *
 * The global-setup signs in as leroysalih@bisak.org (pw: bisak123) and writes
 * storageState.json. If sign-in fails the global-setup throws before any spec runs.
 *
 * IMAGE_OCR_SERVICE_KEY and MARK_SERVICE_KEY must be exported in the shell
 * (or loaded from .env) so the callback simulation steps can authenticate.
 *
 * HOW TO RUN (once seeding is done)
 * ----------------------------------
 *   PLAYWRIGHT_BASE_URL=http://localhost:3002 npx playwright test tests/worksheets/exam-question-ocr.spec.ts
 */

import path from "node:path";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Credentials
// Match the default bcrypt hash in the profiles table (see seeding note above).
// ---------------------------------------------------------------------------
const TEACHER_EMAIL = "leroysalih@bisak.org";
const TEACHER_PASSWORD = "bisak123";
const PUPIL_EMAIL = "p1@bisak.org";
const PUPIL_PASSWORD = "bisak123";

// Fixture image — committed at tests/worksheets/IMG_3784.jpg
const FIXTURE_IMAGE = path.resolve(__dirname, "IMG_3784.jpg");

// ---------------------------------------------------------------------------
// DB helper — uses the same DATABASE_URL as the app under test
// ---------------------------------------------------------------------------
function makePool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — cannot run DB queries in spec");
  }
  return new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  });
}

async function queryDb<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const pool = makePool();
  try {
    const { rows } = await pool.query<T>(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Helper — sign in via the UI as a given user
// ---------------------------------------------------------------------------
async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/signin");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForLoadState("networkidle");
}

// ---------------------------------------------------------------------------
// Helper — sign out via the user menu
// ---------------------------------------------------------------------------
async function signOut(page: import("@playwright/test").Page) {
  const trigger = page.getByRole("button", { name: /open user menu|pupil 1|leroy salih/i }).first();
  if (await trigger.isVisible()) {
    await trigger.click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForLoadState("networkidle");
  }
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------
test.describe("Worksheet OCR → edit → mark", () => {
  test("full OCR lifecycle", async ({ page, request }) => {
    // -- env guard -------------------------------------------------------
    const ocrKey = process.env.IMAGE_OCR_SERVICE_KEY;
    const markKey = process.env.MARK_SERVICE_KEY ?? process.env.AI_MARK_SERVICE_KEY;

    if (!ocrKey) {
      throw new Error(
        "IMAGE_OCR_SERVICE_KEY is not set — OCR callback step cannot run. " +
        "Export the key in your shell before running this spec.",
      );
    }
    if (!markKey) {
      throw new Error(
        "MARK_SERVICE_KEY is not set — marking callback step cannot run. " +
        "Export the key in your shell before running this spec.",
      );
    }

    // ====================================================================
    // TEACHER SETUP — create curriculum → unit → lesson → worksheet activity
    // ====================================================================
    await signIn(page, TEACHER_EMAIL, TEACHER_PASSWORD);

    // Confirm sign-in succeeded
    await expect(page).not.toHaveURL(/\/signin/);

    // Create curriculum
    await page.goto("/curriculum");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Add Curriculum" }).click();
    await page.getByRole("textbox", { name: "Title *" }).fill("OCR Test Curriculum");
    await page.getByLabel("Subject").selectOption("Computing");
    await page.getByRole("button", { name: "Create curriculum" }).click();
    await page.waitForLoadState("networkidle");

    // Create unit
    await page.getByText("OCR Test Curriculum").click();
    await page.getByRole("button", { name: "Add Unit" }).click();
    await page.getByRole("textbox", { name: "Title *" }).fill("OCR Test Unit");
    await page.getByRole("button", { name: "Create unit" }).click();
    await page.waitForLoadState("networkidle");

    // Create lesson
    await page.getByText("OCR Test Unit").click();
    await page.getByRole("button", { name: "Add Lesson" }).click();
    await page.getByRole("textbox", { name: "Title *" }).fill("OCR Test Lesson");
    await page.getByRole("button", { name: "Create lesson" }).click();
    await page.waitForLoadState("networkidle");

    // Navigate to lesson detail
    await page.getByText("OCR Test Lesson").click();
    await page.waitForURL(/lessons\//);
    const lessonUrl = page.url();
    const lessonIdMatch = lessonUrl.match(/lessons\/([a-f0-9-]{36})/);
    if (!lessonIdMatch) {
      throw new Error(`Could not extract lesson_id from URL: ${lessonUrl}`);
    }
    const lessonId = lessonIdMatch[1];

    // Add upload-worksheet activity and capture its id from the network response
    let activityId: string | null = null;
    const activityResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("server-actions") ||
        resp.request().method() === "POST",
      { timeout: 15_000 },
    );

    await page.getByRole("button", { name: "Add Activity" }).click();
    await page.getByText("Select an activity type...").click();
    await page.getByRole("option", { name: /upload.*exam|upload.*worksheet/i }).click();
    await page.getByRole("textbox", { name: /title/i }).fill("Upload Exam Question");
    await page.getByRole("button", { name: "Add Activity" }).click();
    await page.waitForLoadState("networkidle");

    // Fetch the activity id from the DB by title + lesson (deterministic)
    const activityRows = await queryDb<{ activity_id: string }>(
      `SELECT activity_id FROM activities
       WHERE lesson_id = $1
         AND title = 'Upload Exam Question'
         AND type = 'upload-worksheet'
       ORDER BY created_at DESC
       LIMIT 1`,
      [lessonId],
    );
    if (!activityRows.length) {
      throw new Error(
        `Could not find the 'Upload Exam Question' activity in the DB for lesson ${lessonId}. ` +
        "Activity creation may have failed.",
      );
    }
    activityId = activityRows[0].activity_id;

    // ====================================================================
    // Fetch the pupil's user_id from the DB
    // ====================================================================
    const pupilRows = await queryDb<{ user_id: string }>(
      `SELECT user_id FROM profiles WHERE email = $1 LIMIT 1`,
      [PUPIL_EMAIL],
    );
    if (!pupilRows.length) {
      throw new Error(
        `Pupil account '${PUPIL_EMAIL}' not found in the DB. ` +
        "Seed the test accounts before running this spec.",
      );
    }
    const pupilUserId = pupilRows[0].user_id;

    // ====================================================================
    // PUPIL — sign in and upload an image
    // ====================================================================
    await signOut(page);
    await signIn(page, PUPIL_EMAIL, PUPIL_PASSWORD);
    await expect(page).not.toHaveURL(/\/signin/);

    // Navigate to the lesson
    await page.goto(lessonUrl);
    await page.waitForLoadState("networkidle");

    // Confirm the activity title is present
    await expect(page.getByText("Upload Exam Question")).toBeVisible();

    // The file input is hidden; set files on it directly
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURE_IMAGE);

    // ====================================================================
    // Assert "Reading your work…" (extracting) state
    // ====================================================================
    await expect(page.getByText("Reading your work…")).toBeVisible({ timeout: 15_000 });

    // ====================================================================
    // Retrieve submission_id via DB — deterministic, no SSE race
    // ====================================================================
    // Poll for up to 10 s to give the server time to insert the row
    let submissionId: string | null = null;
    const pollDeadline = Date.now() + 10_000;
    while (!submissionId && Date.now() < pollDeadline) {
      const rows = await queryDb<{ submission_id: string }>(
        `SELECT submission_id FROM submissions
         WHERE activity_id = $1 AND user_id = $2
         ORDER BY attempt_number DESC
         LIMIT 1`,
        [activityId, pupilUserId],
      );
      if (rows.length) {
        submissionId = rows[0].submission_id;
      } else {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!submissionId) {
      throw new Error(
        `No submission row found in DB for activity ${activityId} / pupil ${pupilUserId} ` +
        "after 10 s. The upload may have failed or the server is not persisting submissions.",
      );
    }

    // ====================================================================
    // Simulate OCR callback: POST /webhooks/image-to-text
    // ====================================================================
    const ocrResponse = await request.post("/webhooks/image-to-text", {
      headers: {
        "Content-Type": "application/json",
        "image-ocr-service-key": ocrKey,
      },
      data: {
        submission_id: submissionId,
        text: "The pupil's hand-written answer goes here.\n\nSecond paragraph of the answer.",
        group_assignment_id: "e2e__test",
      },
    });

    expect(ocrResponse.status()).toBe(200);
    const ocrBody = await ocrResponse.json();
    expect(ocrBody).toMatchObject({ success: true });

    // ====================================================================
    // Assert extractedText + mark_status via DB (robust — no UI polling race)
    // ====================================================================
    const submissionAfterOcr = await queryDb<{ body: Record<string, unknown>; mark_status: string }>(
      `SELECT body, mark_status FROM submissions WHERE submission_id = $1 LIMIT 1`,
      [submissionId],
    );
    expect(submissionAfterOcr).toHaveLength(1);
    const bodyAfterOcr = submissionAfterOcr[0].body as Record<string, unknown>;
    expect(bodyAfterOcr.extractedText).toContain("pupil's hand-written answer");
    expect(submissionAfterOcr[0].mark_status).toBe("marking");

    // ====================================================================
    // Simulate marking callback: POST /webhooks/ai-mark
    // group_assignment_id uses "groupId__lessonId" format required by the handler
    // ====================================================================
    const markResponse = await request.post("/webhooks/ai-mark", {
      headers: {
        "Content-Type": "application/json",
        "mark-service-key": markKey,
      },
      data: {
        group_assignment_id: "e2e__test",
        activity_id: activityId,
        results: [
          {
            pupilId: pupilUserId,
            score: 3,
            feedback: "Good attempt. Review paragraph structure.",
          },
        ],
      },
    });

    // Accept 200 or 207 (partial success)
    expect([200, 207]).toContain(markResponse.status());

    // ====================================================================
    // Assert ai_marks + mark_status via DB
    // ====================================================================
    const submissionAfterMark = await queryDb<{ body: Record<string, unknown>; mark_status: string }>(
      `SELECT body, mark_status FROM submissions WHERE submission_id = $1 LIMIT 1`,
      [submissionId],
    );
    expect(submissionAfterMark).toHaveLength(1);
    const bodyAfterMark = submissionAfterMark[0].body as Record<string, unknown>;
    expect(typeof bodyAfterMark.ai_marks).toBe("number");
    expect(submissionAfterMark[0].mark_status).toBe("marked");
    expect(typeof bodyAfterMark.ai_model_feedback).toBe("string");

    // ====================================================================
    // TEACHER — sign back in and view results
    // ====================================================================
    await signOut(page);
    await signIn(page, TEACHER_EMAIL, TEACHER_PASSWORD);

    await page.goto(lessonUrl);
    await page.waitForLoadState("networkidle");

    // Results button should be visible for a teacher on the lesson page
    const resultsButton = page.getByRole("button", { name: /results/i });
    if (await resultsButton.isVisible()) {
      await resultsButton.click();
      await expect(page.getByText("Upload Exam Question")).toBeVisible({ timeout: 10_000 });
    }
  });
});
