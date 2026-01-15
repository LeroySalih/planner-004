import { expect, test } from "@playwright/test";

test("Pupil sees correct navigation links", async ({ page }) => {
    // 1. Navigate to home
    await page.goto("/");

    // 2. Sign in as pupil
    await page.getByRole("link", { name: "Sign in" }).click();
    await page.getByLabel("Email address").fill("p1@bisak.org");
    await page.getByLabel("Password").fill("bisak123");
    await page.getByRole("button", { name: "Sign in" }).click();

    // 3. Verify Pupil Links are VISIBLE
    await expect(page.getByRole("link", { name: "My Units" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();

    // 4. Verify Teacher Links are HIDDEN
    await expect(page.getByRole("link", { name: "SoW", exact: true })).not
        .toBeVisible();
    await expect(page.getByRole("link", { name: "Groups", exact: true })).not
        .toBeVisible();
    // Using exact: true to avoid matching "My Units" when checking for "Units" if logic was fuzzy,
    // but separate locators generally handle this. Safety first.
    await expect(page.getByRole("link", { name: "Units", exact: true })).not
        .toBeVisible();
    await expect(page.getByRole("link", { name: "Reports", exact: true })).not
        .toBeVisible();
    await expect(page.getByRole("link", { name: "Curriculum", exact: true }))
        .not.toBeVisible();
});
