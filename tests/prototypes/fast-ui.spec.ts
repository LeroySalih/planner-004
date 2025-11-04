import { test, expect, type Page } from "@playwright/test"
import dotenv from "dotenv"
import path from "node:path"

const envPath = path.resolve(__dirname, "../", ".env.test")
dotenv.config({ path: envPath })

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"
const TEACHER_EMAIL = process.env.TEACHER_EMAIL
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD

if (!TEACHER_EMAIL || !TEACHER_PASSWORD) {
  throw new Error("TEACHER_EMAIL and TEACHER_PASSWORD must be defined in tests/.env.test")
}

async function signInAsTeacher(page: Page) {
  await page.goto(`${BASE_URL}/`)

  await page.getByRole("link", { name: "Sign in" }).click()
  await page.getByRole("textbox", { name: "Email address" }).fill(TEACHER_EMAIL)
  await page.getByRole("textbox", { name: "Password" }).fill(TEACHER_PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("button", { name: "Open user menu" })).toBeVisible()
}

async function signOut(page: Page) {
  const menuButton = page.getByRole("button", { name: "Open user menu" })
  if (await menuButton.isVisible()) {
    await menuButton.click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
  }
}

test.describe("Fast UI prototype", () => {
  test.afterEach(async ({ page }) => {
    await signOut(page)
  })

  test("optimistic counter increments before realtime completion", async ({ page }) => {
    await signInAsTeacher(page)

    await page.goto(`${BASE_URL}/prototypes/fast-ui`)

    await expect(page.getByRole("heading", { name: "Fast UI async counter" })).toBeVisible()

    const counter = page.getByTestId("fast-ui-counter-value")
    const incrementButton = page.getByTestId("fast-ui-increment")
    const status = page.getByTestId("fast-ui-status")

    await expect(counter).toHaveText("0")

    await incrementButton.click()

    await expect(counter).toHaveText("1")
    await expect(status).toContainText("Queued")
  })

  test("rejects increments beyond the counter limit", async ({ page }) => {
    await signInAsTeacher(page)

    await page.goto(`${BASE_URL}/prototypes/fast-ui`)

    const counter = page.getByTestId("fast-ui-counter-value")
    const incrementButton = page.getByTestId("fast-ui-increment")
    const status = page.getByTestId("fast-ui-status")

    for (let i = 0; i < 4; i += 1) {
      await expect(incrementButton).toBeEnabled()
      await incrementButton.click()
    }

    await expect(counter).toHaveText("4")

    await expect(incrementButton).toBeEnabled()
    await incrementButton.click()

    await expect(status).toContainText("limit")
    await expect(counter).toHaveText("4")
  })
})
