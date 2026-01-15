import { expect, test } from "@playwright/test";

// Start with a clean session (not logged in)
test.use({ storageState: { cookies: [], origins: [] } });

test("Pupil sign up, complete profile, and join group", async ({ page }) => {
    // Generate random user details
    const randomId = Math.random().toString(36).substring(2, 7);
    const firstName = `TestPupil_${randomId}`;
    const lastName = "User";
    const email = `pupil_${randomId}@example.com`;
    const password = "password123";
    const joinCode = "E7PST";

    // 1. Navigate to home
    await page.goto("/");

    // 2. Click Sign in
    await page.getByRole("link", { name: "Sign in" }).click();

    // 3. Click Sign up
    await page.getByRole("link", { name: /Sign up/i }).click();

    // 4. Fill Signup Form
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    // 5. Expect redirect to Profile completion (/profiles/[id])
    // 5. Expect redirect to Profile completion (/profiles/[id])
    try {
        await expect(page).toHaveURL(/.*\/profiles\/.+/, { timeout: 15000 });
    } catch (error) {
        // Debug: Check for visible error messages on the page
        const errorMessage = await page.locator(".text-destructive")
            .textContent().catch(() => null);
        if (errorMessage) {
            console.error(
                "Test failed to redirect. Visible Error Message on Page:",
                errorMessage,
            );
        } else {
            console.error(
                "Test failed to redirect. No visible error message found.",
            );
        }
        throw error;
    }
    await expect(page.getByText("Manage your details")).toBeVisible();

    // 6. Fill Profile Form
    await page.getByLabel(/First name/i).fill(firstName);
    await page.getByLabel(/Last name/i).fill(lastName);
    await page.getByRole("button", { name: "Save details" }).click();

    // 7. Verify success toast or message
    await expect(page.getByText("Profile updated successfully")).toBeVisible();

    // 8. Join Group (Groups form is on the same page now)
    await expect(page.getByText("Join a group")).toBeVisible();
    await page.getByLabel("Join a group").fill(joinCode);
    await page.getByRole("button", { name: "Join group" }).click();

    // 10. Verify Group Joined
    await expect(page.getByText(`Joined`)).toBeVisible();
    await expect(page.getByText("25-7A-DT", { exact: true })).toBeVisible();
});
