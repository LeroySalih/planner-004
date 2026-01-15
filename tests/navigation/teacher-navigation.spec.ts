import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("Teacher sees correct navigation links", async ({ page }) => {
    // 1. Create a new user (Sign Up) - Default is Pupil
    const randomId = Math.random().toString(36).substring(2, 7);
    const email = `teacher_${randomId}@example.com`;
    const password = "password123";

    // console.log(`Creating user: ${email}`);

    await page.goto("/");
    await page.getByRole("link", { name: "Sign in" }).click();
    await page.getByRole("link", { name: /Sign up/i }).click();
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    // Wait for signup to complete and redirect
    try {
        await expect(page).toHaveURL(/.*\/profiles\/.+/, { timeout: 15000 });
    } catch (error) {
        const errorMessage = await page.locator(".text-destructive")
            .textContent().catch(() => null);
        console.error("Signup redirect failed. Visible Error:", errorMessage);
        throw error;
    }

    // 2. Sign Out
    await page.getByRole("button", { name: "Open user menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/");

    // 3. Sign in as Admin (leroysalih@bisak.org)
    await page.getByRole("link", { name: "Sign in" }).click();
    await page.getByLabel("Email address").fill("leroysalih@bisak.org");
    await page.getByLabel("Password").fill("bisak123");
    await page.getByRole("button", { name: "Sign in" }).click();

    // 4. Promote User to Teacher using Admin UI
    await page.goto("/admin/roles");

    // Filter for the new user
    await page.getByPlaceholder("Search users...").fill(email);

    // Wait for the row to appear
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toBeVisible();

    // Open Edit Roles
    await row.getByRole("button", { name: "Edit Roles" }).click();

    // Role Menu Items
    const teacherItem = page.getByRole("menuitemcheckbox", { name: "teacher" });
    const pupilItem = page.getByRole("menuitemcheckbox", { name: "pupil" });

    // Add Teacher Role
    await teacherItem.click();
    // Wait for toast or optimistic update? The menu stays open?
    // Usually clicking an item in dropdown might close it OR keep it open depending on implementation (DropdownMenuCheckboxItem usually keeps open or closes).
    // If it closes, we need to reopen.
    // shadcn/ui DropdownMenuCheckboxItem usually does NOT close by default? Or does?
    // Let's assume it might close, so we check visibility.
    if (!(await pupilItem.isVisible())) {
        await row.getByRole("button", { name: "Edit Roles" }).click();
    }

    // Remove Pupil Role
    await pupilItem.click();

    // 5. Sign Out Admin
    // (Refresh to ensure no lingering menu state issues)
    await page.reload();
    await page.getByRole("button", { name: "Open user menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/");

    // 6. Sign in as New Teacher
    await page.getByRole("link", { name: "Sign in" }).click();
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // 7. Verify Teacher Links are VISIBLE
    await expect(page.getByRole("link", { name: "SoW", exact: true }))
        .toBeVisible();
    await expect(page.getByRole("link", { name: "Groups", exact: true }))
        .toBeVisible();
    await expect(page.getByRole("link", { name: "Units", exact: true }))
        .toBeVisible();
    await expect(page.getByRole("link", { name: "Reports", exact: true }))
        .toBeVisible();
    await expect(page.getByRole("link", { name: "Curriculum", exact: true }))
        .toBeVisible();

    // 8. Verify Pupil Links are HIDDEN
    await expect(page.getByRole("link", { name: "My Units" })).not
        .toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).not
        .toBeVisible();
});
