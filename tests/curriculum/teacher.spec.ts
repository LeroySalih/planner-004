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
  await expect(page.locator('h1')).toContainText('Curriculum Explorer');
  await expect(page.locator('body')).toContainText('Computing - KS3');
  await expect(page.getByLabel('Export curriculum Computing')).toContainText('Export');
  
});