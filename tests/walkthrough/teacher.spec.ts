import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('textbox', { name: 'Email address' }).click();
  await page.getByRole('textbox', { name: 'Email address' }).fill('leroysalih@bisak.org');
  await page.getByRole('textbox', { name: 'Email address' }).press('Tab');
  await page.getByRole('textbox', { name: 'Password' }).fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Curriculum' }).click();
  await page.waitForURL('**/curriculum');
  await expect(page.getByRole('heading', { name: 'Curriculum Explorer' })).toBeVisible();
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.locator('#reports-page-title')).toContainText('Reports');
  await page.getByRole('link', { name: 'Units' }).click();
  await expect(page.getByRole('heading')).toContainText('Units Overview');
  await page.getByRole('link', { name: 'Groups' }).click();
  await expect(page.getByRole('navigation')).toContainText('Groups');
  await page.getByRole('link', { name: 'SoW' }).click();
  await expect(page.getByRole('navigation')).toContainText('SoW');
});
