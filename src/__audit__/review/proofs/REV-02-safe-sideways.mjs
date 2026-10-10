// REV-02 (low): a safe's page scrolls sideways on every phone narrower than
// 418px, connected or not, because the full address under the title
// (Safe.tsx:299, AddressLine with short={false}) is a 62-character token in a
// nowrap inline-flex line that cannot break: 379px of monospace text in a
// 343px column. The mobile commit (28a2b39, "no sideways scroll") fixed the
// list only. Exits 1 while the page is wider than the phone, 0 once it is not.
//
//   node src/__audit__/review/proofs/REV-02-safe-sideways.mjs
//     BUILD=./build  serves a local build from disk (default: ./build)
//     SITE=https://mvxsafe.io  checks the live site instead
//
// Nothing is read from the chain either way: every request to the MultiversX
// API is aborted, so the page shows its "could not be read" state, with the
// same title block. jsdom has no layout, which is why this is a browser proof.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const SITE = process.env.SITE || '';
const BUILD = resolve(process.env.BUILD || 'build');
const ORIGIN = SITE || 'https://app.test';
const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' };

if (!SITE && !existsSync(join(BUILD, 'index.html'))) {
  console.log(`No build at ${BUILD}: pass BUILD=<dir> or SITE=<url>.`);
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
const page = await context.newPage();
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.origin === ORIGIN) {
    if (SITE) return route.continue();
    let file = join(BUILD, decodeURIComponent(url.pathname));
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(BUILD, 'index.html');
    return route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] || 'application/octet-stream' });
  }
  return route.abort();
});

let failed = false;
for (const width of [320, 375, 390, 412, 430]) {
  await page.setViewportSize({ width, height: 700 });
  await page.goto(`${ORIGIN}/safe/${SAFE}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const limit = window.innerWidth;
    const culprits = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > limit + 0.5 && !el.querySelector('*'))
      .slice(0, 2)
      .map((el) => `<${el.tagName.toLowerCase()}> ${el.getBoundingClientRect().width.toFixed(0)}px "${(el.textContent || '').trim().slice(0, 40)}"`);
    return { scrollWidth: document.documentElement.scrollWidth, limit, culprits };
  });
  const sideways = result.scrollWidth > result.limit;
  if (sideways && width < 418) failed = true;
  console.log(`${width}px: page is ${result.scrollWidth}px wide, ${sideways ? 'SCROLLS SIDEWAYS' : 'fits'}${result.culprits.length ? `; widest: ${result.culprits.join(', ')}` : ''}`);
}
await browser.close();
console.log(failed ? '\nREV-02 reproduces: the safe page scrolls sideways on a phone.' : '\nThe safe page fits a phone.');
process.exit(failed ? 1 : 0);
