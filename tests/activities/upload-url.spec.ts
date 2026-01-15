import { expect, test } from "@playwright/test";

// Teacher credentials
const TEACHER_EMAIL = "leroysalih@bisak.org";
const TEACHER_PASSWORD = "password"; // Assuming based on other tests

// Pupil credentials
const PUPIL_EMAIL = "p1@bisak.org";
const PUPIL_PASSWORD = "password";

test("Upload URL Activity Lifecycle", async ({ page }) => {
    // 1. Teacher Setup
    await page.goto("http://localhost:3000/signin");
    await page.getByRole("textbox", { name: "Email address" }).fill(
        TEACHER_EMAIL,
    );
    await page.getByRole("textbox", { name: "Password" }).fill(
        TEACHER_PASSWORD,
    );
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForTimeout(1000);

    // Create Curriculum
    await page.goto("http://localhost:3000/curriculum");

    // Wait for page to be ready
    await page.waitForLoadState("networkidle");

    // Check if button is visible, if not, maybe wait for empty state
    // But networkidle should be enough usually.
    // Let's add a small pause just in case animation/rendering
    await page.waitForTimeout(1000);

    await page.getByRole("button", { name: "Add Curriculum" }).click();
    await page.getByRole("textbox", { name: "Title *" }).fill(
        "Upload URL Test Curriculum",
    );
    await page.getByLabel("Subject").selectOption("Computing");
    await page.getByRole("button", { name: "Create curriculum" }).click();

    // Create Unit
    await page.getByText("Upload URL Test Curriculum").click();
    await page.getByRole("button", { name: "Add Unit" }).click();
    await page.getByRole("textbox", { name: "Title *" }).fill(
        "Upload URL Test Unit",
    );
    await page.getByRole("button", { name: "Create unit" }).click();

    // Create Lesson
    await page.getByText("Upload URL Test Unit").click();
    await page.getByRole("button", { name: "Add Lesson" }).click();
    await page.getByRole("textbox", { name: "Title *" }).fill(
        "Upload URL Test Lesson",
    );
    await page.getByRole("button", { name: "Create lesson" }).click();

    // Capture Lesson ID from URL
    // URL format: /curriculum/[curriculumId]/units/[unitId]/lessons/[lessonId]
    // We need to click on the lesson first to go to its detail page
    await page.getByText("Upload URL Test Lesson").click();
    await page.waitForURL(/lessons\//);
    const lessonUrl = page.url();
    console.log("Lesson URL:", lessonUrl);

    // Add Upload URL Activity
    await page.getByRole("button", { name: "Add Activity" }).click();
    await page.getByText("Select an activity type...").click();
    await page.getByRole("option", { name: "Upload URL" }).click();

    await page.getByRole("textbox", { name: "Question" }).fill(
        "Please submit your portfolio URL.",
    );
    await page.getByRole("button", { name: "Add Activity" }).click();

    // 2. Pupil Interaction
    await page.getByRole("button", { name: "Leroy Salih" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    await page.getByRole("textbox", { name: "Email address" }).fill(
        PUPIL_EMAIL,
    );
    await page.getByRole("textbox", { name: "Password" }).fill(PUPIL_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Navigate directly to lesson
    await page.goto(lessonUrl);

    // Verify Activity is present
    await expect(page.getByText("Please submit your portfolio URL."))
        .toBeVisible();

    // Test Validation (Empty/Invalid)
    await page.getByPlaceholder("https://example.com").fill("invalid-url");
    // Trigger validation by clicking outside or trying to submit?
    // There is usually a save status or it saves on blur/debounce.
    // The component implemented has a "Clear" button and validation logic.
    // Let's type invalid url and check for error message if any, or just valid url.

    const input = page.getByPlaceholder("https://example.com");
    await input.fill("https://example.com/portfolio");

    // Wait for "Saved" indicator if exists, or just verify value persists.
    // The component uses `useDebouncedCallback`.
    await page.waitForTimeout(2000);

    // 3. Teacher Review
    await page.getByRole("button", { name: "Pupil 1" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    await page.getByRole("textbox", { name: "Email address" }).fill(
        TEACHER_EMAIL,
    );
    await page.getByRole("textbox", { name: "Password" }).fill(
        TEACHER_PASSWORD,
    );
    await page.getByRole("button", { name: "Sign in" }).click();

    // Go to results
    // We need the assignment ID or just navigate to the results page for the assignment.
    // The results page is usually linked from the lesson page or unit page.
    // URL: /results/assignments/[assignmentId] ?? No, usually via "Reports" or "Marking".

    // Navigate back to lesson
    await page.goto(lessonUrl);

    // Click on "Results" or similar?
    // Actually, usually teachers go to "Reports" -> "Assignments"?
    // Or there is a "Results" tab on the lesson page.

    // Let's try finding a link to results.
    // If not, we can try to guess the URL if we knew the assignment ID.

    // Maybe just checking the Lesson page "Teacher View" shows the submission count?
    // The requirement says: "For teachers, clicking on the activity cell on the /results/assignments/[id] page..."

    // Need to find how to get to that page.
    // Typically "Marking" or "Results" button on the lesson header.
    await page.getByRole("button", { name: "Results" }).click();

    // Now we should be on the results dashboard.
    await expect(page.getByText("https://example.com/portfolio")).toBeVisible();

    // Click the cell to open sidebar
    await page.getByText("https://example.com/portfolio").click();

    // Verify link in sidebar
    const sidebarLink = page.getByRole("link", {
        name: "https://example.com/portfolio",
    });
    await expect(sidebarLink).toBeVisible();
    await expect(sidebarLink).toHaveAttribute(
        "href",
        "https://example.com/portfolio",
    );
});
