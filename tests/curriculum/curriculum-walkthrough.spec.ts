import { test, expect } from '@playwright/test';

async function ensureSignedIn(page: import('@playwright/test').Page) {
  const email = process.env.PW_EMAIL ?? 'leroysalih@bisak.org';
  const password = process.env.PW_PASSWORD ?? 'bisak123';

  await page.goto('http://localhost:3000/signin');
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForLoadState('networkidle');
  await page.goto('http://localhost:3000/curriculum');
  await page.waitForURL('**/curriculum', { timeout: 15000 });
}

test.beforeAll(async () => {

  console.log('Resetting database to clean state before test');
  // Reset the database to a clean state before each test
  const { exec } = require('child_process');
  await new Promise((resolve, reject) => {
    
    console.log("Cleaning DB");

    exec('npm run db:clean', (error: any, stdout: any, stderr: any) => {
      if (error) {
        console.error(`Error resetting database: ${error}`);
        reject(error);
      } else {
        console.log(`Database reset successful: ${stdout}`);
        resolve(stdout);
      }
    });
  });
});

test('Curriculum CRUD', async ({ page }) => {
  await ensureSignedIn(page);
  console.info('[curriculum-test] current url:', page.url());
  await expect(page).toHaveURL(/curriculum/, { timeout: 15000 });

  const emptyState = page.getByTestId('no curriculum loaded');
  await expect(emptyState).toBeVisible({ timeout: 15000 });
  await expect(emptyState).toContainText('No curricula found yet. Once curricula are created they will appear here.');
  await page.getByRole('button', { name: 'Add Curriculum' }).click();
  await page.getByRole('textbox', { name: 'Title *' }).fill('Design and Technology');
  await page.getByLabel('Subject').selectOption('Design Technology');
  await page.getByRole('button', { name: 'Create curriculum' }).click();
  await expect(page.getByTestId('Design and Technology')).toContainText('Design and Technology');
  await page.getByRole('button', { name: 'Edit curriculum Design and' }).click();
  await page.getByRole('textbox', { name: 'Title' }).click();
  await page.getByRole('textbox', { name: 'Title' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('Shift+ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('Shift+ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).press('Shift+ArrowLeft');
  await page.getByRole('textbox', { name: 'Title' }).fill('Design & Technology');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('Design & Technology')).toContainText('Design & Technology');
  await page.getByRole('button', { name: 'Edit curriculum Design &' }).click();
  await page.getByRole('button', { name: 'Set inactive' }).click();
  await expect(page.locator('body')).toContainText('No active curricula right now. Enable "Show inactive curricula" to review archived entries.');
  await page.getByRole('switch', { name: 'Show inactive curricula' }).click();
  await expect(page.getByTestId('Design & Technology')).toContainText('Design & Technology');
  await expect(page.locator('body')).toContainText('Inactive');
  await page.getByRole('button', { name: 'Edit curriculum Design &' }).click();
  await page.getByRole('button', { name: 'Set active' }).click();
  await page.getByRole('switch', { name: 'Show inactive curricula' }).click();
  await expect(page.getByTestId('Design & Technology')).toContainText('Design & Technology');
});

