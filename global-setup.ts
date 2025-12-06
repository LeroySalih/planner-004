import { chromium, request } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const STORAGE_PATH = 'storageState.json';
const SERVER_PID_FILE = path.join(process.cwd(), '.playwright-server.pid');
const DEFAULT_EMAIL = 'leroysalih@bisak.org';
const DEFAULT_PASSWORD = 'bisak123';

async function waitForServer(url: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok || res.status === 401) return true;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

function startServer(): { child: ReturnType<typeof spawn> | null } {
  const child = spawn('npm', ['run', 'dev', '--', '-p', '3000'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });
  if (child.pid) {
    fs.writeFileSync(SERVER_PID_FILE, String(child.pid), { encoding: 'utf8' });
  }
  return { child };
}

export default async function globalSetup() {
  console.log('[global-setup] Starting dev server for auth bootstrap...');
  const { child } = startServer();
  await waitForServer(BASE_URL);
  console.log('[global-setup] Server is up, creating authenticated storage state...');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('textbox', { name: 'Email address' }).fill(process.env.PW_EMAIL ?? DEFAULT_EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.PW_PASSWORD ?? DEFAULT_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForLoadState('networkidle');
  await page.goto(`${BASE_URL}/curriculum`, { waitUntil: 'networkidle' });
  if (page.url().includes('/signin')) {
    await browser.close();
    throw new Error('[global-setup] Login failed; remained on signin page.');
  }
  await page.context().storageState({ path: STORAGE_PATH });
  await browser.close();

  if (child && child.pid) {
    console.log(`[global-setup] Server running with pid ${child.pid}. It will be stopped in global-teardown.`);
  }
}
