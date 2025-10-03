import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('textbox', { name: 'Email address' }).click();
  await page.getByRole('textbox', { name: 'Email address' }).fill('p1@bisak.org');
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('banner')).toContainText('Pupil 1 Test');
  await expect(page.getByRole('navigation')).toContainText('My Lessons');

  // check that the teacher menu is not in the dom
  await expect(page.getByText('SoW')).toHaveCount(0);
  await expect(page.getByText('Groups')).toHaveCount(0);
  await expect(page.getByText('Units')).toHaveCount(0);
  await expect(page.getByText('Reports')).toHaveCount(0);
  await expect(page.getByText('Curriculum')).toHaveCount(0);

  // sign out
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
});