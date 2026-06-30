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
