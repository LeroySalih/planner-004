import { test, expect } from "@playwright/test"

// These tests require at least one lesson marked is_public = true in the test DB.
// Set TEST_PUBLIC_LESSON_ID and TEST_PRIVATE_LESSON_ID in tests/.env.test
// Run to seed: psql $DATABASE_URL -c "UPDATE lessons SET is_public = true WHERE lesson_id = (SELECT lesson_id FROM lessons LIMIT 1)"

const PUBLIC_LESSON_ID = process.env.TEST_PUBLIC_LESSON_ID ?? ""
const PRIVATE_LESSON_ID = process.env.TEST_PRIVATE_LESSON_ID ?? ""

test.describe("Public lessons", () => {
  test("sign-in page shows public lesson browser", async ({ page }) => {
    await page.goto("/signin")
    await expect(page.getByText("Browse Lessons")).toBeVisible()
    await expect(page.getByText("Sign in to Dino")).toBeVisible()
  })

  test("clicking a public lesson loads it inline", async ({ page }) => {
    test.skip(!PUBLIC_LESSON_ID, "TEST_PUBLIC_LESSON_ID not set — skipping")
    await page.goto("/signin")
    const lessonLink = page.locator("button").filter({ hasText: "📄" }).first()
    await expect(lessonLink).toBeVisible()
    await lessonLink.click()
    await expect(page.getByText("Back to lessons")).toBeVisible()
    await expect(page.getByText("Want to do more?")).toBeVisible()
    await expect(page.getByRole("link", { name: /Sign in/i })).toBeVisible()
  })

  test("back button returns to browser state", async ({ page }) => {
    test.skip(!PUBLIC_LESSON_ID, "TEST_PUBLIC_LESSON_ID not set — skipping")
    await page.goto("/signin")
    const lessonLink = page.locator("button").filter({ hasText: "📄" }).first()
    await lessonLink.click()
    await page.getByText("Back to lessons").click()
    await expect(page.getByText("Browse Lessons")).toBeVisible()
    await expect(page.getByText("Sign in to Dino")).toBeVisible()
  })

  test("direct link to public lesson shows public view", async ({ page }) => {
    test.skip(!PUBLIC_LESSON_ID, "TEST_PUBLIC_LESSON_ID not set — skipping")
    await page.goto(`/lessons/${PUBLIC_LESSON_ID}`)
    await expect(page.getByText("Sign in")).toBeVisible()
    await expect(page.getByText("Continue learning with Dino")).toBeVisible()
  })

  test("direct link to private lesson redirects to sign-in", async ({ page }) => {
    test.skip(!PRIVATE_LESSON_ID, "TEST_PRIVATE_LESSON_ID not set — skipping")
    await page.goto(`/lessons/${PRIVATE_LESSON_ID}`)
    await expect(page).toHaveURL(/\/signin/)
  })
})
