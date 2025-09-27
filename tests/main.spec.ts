import {test, expect} from "@playwright/test";

test.describe("Home Page", ()=>{


    test("should have correct title", async ({page})=>{
        await page.goto("http://localhost:3000/");

        await expect(page).toHaveTitle(/Dino/);
    });

});


test.describe('Top menu bar', () => {
  
    test.beforeEach(async ({ page }) => {
        await page.goto("http://localhost:3000/");
    });

  test('should display all top menu items', async ({ page }) => {
    // You can target by text since these are <Link> elements with visible text
    await expect(page.getByRole('link', { name: 'SoW' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Groups' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Units' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Curriculum' })).toBeVisible();
  });
});