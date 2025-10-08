import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import path from "path";

// Load Variables
const env_path = path.resolve(__dirname,"../",".env.test");
console.log("Env Path is", env_path);
dotenv.config({path: env_path});

console.log("Teacher Email:", process.env.TEACHER_EMAIL);

// Check variables are loaded. 
if ((process.env.TEACHER_EMAIL || "NOT DEFINED") == "NOT DEFINED") {
  throw (new Error (".env files are not defined."))
}

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
  await page.getByRole('textbox', { name: 'Email address' }).fill(process.env.TEACHER_EMAIL || "NOT DEFINED");
  await page.getByRole('textbox', { name: 'Email address' }).press('Tab');
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.TEACHER_PASSWORD || "NOT DEFINED");
  await page.getByRole('button', { name: 'Sign in' }).click();
  
  // check button name has updated
  await page.waitForTimeout(3000); // Wait 3 seconds
  await expect(page.getByRole('banner')).toContainText('Leroy Salih');

  // sign out
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  
});