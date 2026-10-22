// Checks by hand that guardProfile leaves no profile and no Chrome behind,
// however a capture run ends (reviews of PR #15, 22 Oct 2026). Each ending
// runs in its own process, headless, with a session cookie in a throwaway
// profile, and a page kept busy the way guide.mjs keeps it, polling.
//
//   node scripts/capture/profile-check.mjs        (CHROMIUM=<path> for another browser)
//
// Exit 0 when every ending left nothing, 1 otherwise.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDINGS = ['ctrl-c', 'ctrl-c-twice', 'sigterm', 'error', 'normal'];

if (process.env.ENDING) {
  const { chromium } = await import('@playwright/test');
  const { guardProfile } = await import('./profile.mjs');
  const dir = process.env.PROFILE;
  const context = await chromium.launchPersistentContext(dir, {
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
  });
  const finish = guardProfile(dir, context);
  await context.addCookies([{ name: 'session', value: 'x'.repeat(1000), url: 'https://wallet.example' }]);
  const page = context.pages()[0] ?? (await context.newPage());
  const ending = process.env.ENDING;
  if (ending.startsWith('ctrl-c')) {
    setTimeout(() => process.kill(process.pid, 'SIGINT'), 300);
    if (ending === 'ctrl-c-twice') setTimeout(() => process.kill(process.pid, 'SIGINT'), 350);
  }
  if (ending === 'sigterm') setTimeout(() => process.kill(process.pid, 'SIGTERM'), 300);
  if (ending === 'error') {
    await page.waitForTimeout(300);
    throw new Error('a step failed');
  }
  if (ending === 'normal') {
    await page.waitForTimeout(300);
    await finish(0);
  }
  // As guide.mjs's until() does: a page call every 100 ms, which fails once
  // closing Chrome has closed the page.
  for (;;) await page.waitForTimeout(100);
}

let failed = false;
for (const ending of ENDINGS) {
  const dir = mkdtempSync(join(tmpdir(), 'profile-check-'));
  const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, ENDING: ending, PROFILE: dir },
    encoding: 'utf8',
    timeout: 60000
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const chrome = spawnSync('pgrep', ['-f', `user-data-dir=${dir}`]).stdout.toString().trim();
  const left = existsSync(dir);
  const ok = !left && !chrome;
  failed ||= !ok;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${ending}: exit ${run.status}, profile ${left ? 'LEFT' : 'gone'}, Chrome ${chrome ? 'STILL RUNNING' : 'gone'}`);
}
process.exit(failed ? 1 : 0);
