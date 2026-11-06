// Checks a live site's MetaMask section the way a signer meets it: a fresh
// browser opens SITE/guide#metamask, and the page has to land on the section,
// play the walkthrough video and serve the guide PDF, with no content-policy
// violation on the way. Headless; nothing is signed or sent.
//
//   SITE=https://mvxsafe.io node scripts/ops/guide-metamask-check.mjs
//   SITE=https://localhost:4447 node scripts/ops/guide-metamask-check.mjs
//
// CHROMIUM names a browser to use instead of Playwright's own. Exits 1 on any
// failure.
import { chromium } from '@playwright/test';

const SITE = (process.env.SITE ?? 'https://mvxsafe.io').replace(/\/$/, '');
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(SITE);
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
);
const context = await browser.newContext({
  ignoreHTTPSErrors: isLocal,
  viewport: { width: 1280, height: 900 }
});
const page = await context.newPage();
const violations = [];
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (event) => {
    window.__violations = [
      ...(window.__violations ?? []),
      `${event.violatedDirective} ${event.blockedURI}`
    ];
  });
});
page.on('console', (message) => {
  if (/Content Security Policy/i.test(message.text()))
    violations.push(message.text());
});

let failed = false;
const check = (ok, text) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${text}`);
  if (!ok) failed = true;
};

await page.goto(`${SITE}/guide#metamask`, {
  waitUntil: 'load',
  timeout: 120000
});
// The pictures above load and push the page; the section is followed meanwhile.
await page.waitForTimeout(5000);
const where = await page.evaluate(() => {
  const section = document.getElementById('metamask');
  return section
    ? {
        top: section.getBoundingClientRect().top,
        title: section.querySelector('h2')?.textContent,
        scrollY: window.scrollY
      }
    : null;
});
check(
  Boolean(where),
  `the page has a section #metamask${where ? `, "${where.title}"` : ''}`
);
check(
  Boolean(where) && where.scrollY > 0 && Math.abs(where.top) < 40,
  `a fresh load of /guide#metamask opens on it (its top is ${where ? Math.round(where.top) : '?'} px from the top of the window, scrolled ${where ? Math.round(where.scrollY) : '?'} px)`
);

const video = await page.evaluate(async () => {
  const element = document.querySelector('#metamask video');
  if (!element) return null;
  if (element.readyState < 1)
    await new Promise((resolve) => {
      element.addEventListener('loadedmetadata', resolve, { once: true });
      element.addEventListener('error', resolve, { once: true });
      element.load();
      setTimeout(resolve, 20000);
    });
  return {
    src: element.currentSrc,
    duration: element.duration,
    readyState: element.readyState,
    error: element.error?.code ?? null
  };
});
check(
  Boolean(video) &&
    video.readyState >= 1 &&
    video.duration > 200 &&
    !video.error,
  `the video loads: ${video ? `${video.src}, ${Math.round(video.duration)} s, ready state ${video.readyState}${video.error ? `, error ${video.error}` : ''}` : 'no video element'}`
);

for (const path of [
  '/mvxsafe-metamask-guide.pdf',
  '/mvxsafe-metamask-walkthrough.mp4'
]) {
  const answer = await page.request.get(`${SITE}${path}`, {
    headers: { Range: 'bytes=0-1023' }
  });
  check(
    answer.status() === 200 || answer.status() === 206,
    `${path}: HTTP ${answer.status()}, ${answer.headers()['content-type']}`
  );
}

const policy = await page.evaluate(() => window.__violations ?? []);
check(
  policy.length === 0 && violations.length === 0,
  `no content-policy violation${policy.length + violations.length ? `: ${[...policy, ...violations].join('; ')}` : ''}`
);

await browser.close();
console.log(
  failed
    ? '\nFAILED'
    : `\nOK: ${SITE}/guide#metamask opens on the MetaMask section, with its video and PDF`
);
process.exit(failed ? 1 : 0);
