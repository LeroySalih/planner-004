import { expect, test } from "@playwright/test"

test.describe("pupil units page — mobile unit dropdown", () => {
  test.beforeEach(async ({ page }) => {
    // Use a mobile viewport so md:hidden elements are visible and md:block elements are hidden
    await page.setViewportSize({ width: 390, height: 844 })

    await page.goto("/")
    await page.getByRole("link", { name: "Sign in" }).click()
    await page.getByLabel("Email address").fill("p1@bisak.org")
    await page.getByLabel("Password").fill("bisak123")
    await page.getByRole("button", { name: "Sign in" }).click()

    // Navigate to My Units page (on mobile the nav is inside a hamburger sheet)
    await page.getByRole("button", { name: "Open navigation menu" }).click()
    await page.getByRole("link", { name: "My Units" }).click()
    await page.waitForURL(/\/pupil-lessons\/.+/)
  })

  test("subject dropdown does not contain 'All Subjects'", async ({ page }) => {
    const subjectSelect = page.locator("#subject-select")
    await expect(subjectSelect).toBeVisible()
    const options = await subjectSelect.locator("option").allTextContents()
    expect(options).not.toContain("All Subjects")
    expect(options.length).toBeGreaterThan(0)
  })

  test("unit dropdown is visible on mobile", async ({ page }) => {
    const unitSelect = page.locator("#unit-select")
    await expect(unitSelect).toBeVisible()
  })

  test("unit dropdown is hidden on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const unitSelect = page.locator("#unit-select")
    await expect(unitSelect).toBeHidden()
  })

  test("unit dropdown repopulates when subject changes", async ({ page }) => {
    const subjectSelect = page.locator("#subject-select")
    const unitSelect = page.locator("#unit-select")

    // Get all subject options
    const subjectOptions = await subjectSelect.locator("option").allTextContents()

    if (subjectOptions.length < 2) {
      // Only one subject — can't test repopulation, skip
      test.skip()
      return
    }

    // Pick the second subject
    const secondSubject = subjectOptions[1]
    await subjectSelect.selectOption({ label: secondSubject })

    // Unit options should have updated
    const newOptions = await unitSelect.locator("option").allTextContents()
    expect(newOptions.length).toBeGreaterThan(0)
    const selectedUnitValue = await unitSelect.inputValue()
    expect(selectedUnitValue).not.toBe("")
  })
})
