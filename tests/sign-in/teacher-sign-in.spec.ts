import { test, expect } from '@playwright/test';

test('Teacher sign in', async ({ page }) => {
  await page.goto('http://localhost:3000/');

  // check that the menu is not in the dom
  await expect(page.getByText('SoW')).toHaveCount(0);
  await expect(page.getByText('Groups')).toHaveCount(0);
  await expect(page.getByText('Units')).toHaveCount(0);
  await expect(page.getByText('Reports')).toHaveCount(0);
  await expect(page.getByText('Curriculum')).toHaveCount(0);

  // Teacher Sign In Process
  await expect(page.getByRole('banner')).toContainText('Sign in');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('textbox', { name: 'Email address' }).click();
  await page.getByRole('textbox', { name: 'Email address' }).fill('tt@bisak.org');
  await page.getByRole('textbox', { name: 'Email address' }).press('Tab');
  await page.getByRole('textbox', { name: 'Password' }).fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation')).toContainText('SoW');
  await expect(page.getByRole('navigation')).toContainText('Groups');
  await expect(page.getByRole('navigation')).toContainText('Units');
  await expect(page.getByRole('navigation')).toContainText('Reports');
  await expect(page.getByRole('navigation')).toContainText('Curriculum');
  await expect(page.getByRole('banner')).toContainText('Test Teacher');
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  
});