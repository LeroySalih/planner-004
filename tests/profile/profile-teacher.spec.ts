import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('textbox', { name: 'Email address' }).click();
  await page.getByRole('textbox', { name: 'Email address' }).fill('tt@bisak.org');
  await page.getByRole('textbox', { name: 'Email address' }).press('Tab');
  await page.getByRole('textbox', { name: 'Password' }).fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Test Teacher' }).click();
  await page.getByRole('textbox', { name: 'First name' }).click();
  await page.getByRole('textbox', { name: 'First name' }).click();
  await page.getByRole('textbox', { name: 'First name' }).fill('Test-test');
  await page.getByRole('textbox', { name: 'Last name' }).click();
  await page.getByRole('textbox', { name: 'Last name' }).fill('Teacher-test');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('form')).toContainText('Profile updated successfully.');
  await expect(page.getByRole('banner')).toContainText('Test-test Teacher-test');
  await page.getByRole('textbox', { name: 'First name' }).click();
  await page.getByRole('textbox', { name: 'First name' }).fill('Test');
  await page.getByRole('textbox', { name: 'Last name' }).click();
  await page.getByRole('textbox', { name: 'Last name' }).fill('Teacher');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('banner')).toContainText('Test Teacher');
  await expect(page.getByRole('banner')).toContainText('Test Teacher');
});