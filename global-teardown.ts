import fs from 'node:fs';
import process from 'node:process';

const SERVER_PID_FILE = '.playwright-server.pid';

export default async function globalTeardown() {
  if (!fs.existsSync(SERVER_PID_FILE)) return;

  const pidRaw = fs.readFileSync(SERVER_PID_FILE, { encoding: 'utf8' }).trim();
  const pid = Number(pidRaw);
  if (Number.isNaN(pid)) return;

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`[global-teardown] Stopped dev server (pid ${pid}).`);
  } catch (error: any) {
    if (error?.code !== 'ESRCH') {
      console.warn('[global-teardown] Unable to stop dev server', error);
    }
  } finally {
    fs.rmSync(SERVER_PID_FILE, { force: true });
  }
}
