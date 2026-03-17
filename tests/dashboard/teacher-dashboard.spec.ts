import { expect, test } from "@playwright/test"

// Credentials match the default test teacher used in global-setup and other specs
const TEACHER_EMAIL = "leroysalih@bisak.org"
const TEACHER_PASSWORD = "bisak123"

test.describe("Teacher dashboard", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeEach(async ({ page }) => {
    await page.goto("/signin")
    await page.getByRole("textbox", { name: "Email address" }).fill(TEACHER_EMAIL)
    await page.getByRole("textbox", { name: "Password" }).fill(TEACHER_PASSWORD)
    await page.getByRole("button", { name: "Sign in" }).click()
    // Teachers are redirected to /assignments after sign-in; navigate to dashboard root
    await page.waitForURL(/\/(assignments|$)/)
    await page.goto("/")
  })

  test("teacher sees dashboard at root after sign-in", async ({ page }) => {
    await expect(page).toHaveURL("/")
    await expect(page.getByText("Teacher Dashboard")).toBeVisible()
    await expect(page.getByText("Needs Review")).toBeVisible()
    await expect(page.getByText("Flagged")).toBeVisible()
    await expect(page.getByText("Mentions")).toBeVisible()
  })

  test("Assignments link navigates to assignment manager", async ({ page }) => {
    await page.getByRole("link", { name: "Assignments →" }).click()
    await expect(page).toHaveURL("/assignments")
  })

  test("unauthenticated user is redirected to sign in", async ({ page }) => {
    // Clear session and verify redirect
    await page.context().clearCookies()
    await page.goto("/")
    await expect(page).toHaveURL(/\/signin/)
  })

  test("lesson title in needs-review panel links to feedback page", async ({ page }) => {
    // Only runs if there are items in the marking queue
    const firstLink = page.locator("section").first().getByRole("link").first()
    const count = await firstLink.count()
    test.skip(count === 0, "No items in marking queue in test environment")
    if (count === 0) return
    const href = await firstLink.getAttribute("href")
    expect(href).toMatch(/\/feedback\/groups\/.+\/lessons\/.+/)
  })
})
