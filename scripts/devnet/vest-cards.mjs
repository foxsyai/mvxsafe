// The cards of pending vesting actions, read in the real app (a local
// `vite preview` of a devnet build, or the devnet site) by a browser with no
// wallet: reading a safe needs none. Prints each vesting card's text and saves
// a screenshot of it, for the rehearsal's write-up and the signer's guide.
//
//   TARGET=https://localhost:4447 OUT=<folder> node scripts/devnet/vest-cards.mjs <action ids...>
//
// CHROMIUM names a browser to use instead of Playwright's own.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const TARGET = (process.env.TARGET ?? 'https://localhost:4447').replace(/\/$/, '');
const SAFE = process.env.SAFE ?? 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const OUT = process.env.OUT ?? 'vest-cards';
const ids = process.argv.slice(2).map(Number);
mkdirSync(OUT, { recursive: true });

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(TARGET);
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const context = await browser.newContext({ ignoreHTTPSErrors: isLocal, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(`${TARGET}/safe/${SAFE}`, { waitUntil: 'domcontentloaded', timeout: 120000 });

for (const id of ids) {
  // The card: the parent of the row whose number reads #id.
  const header = page.locator(`div:has(> p > span:text-is("#${id}"))`).first();
  await header.waitFor({ timeout: 180000 });
  const card = header.locator('..');
  // Once its checks have arrived.
  await page.waitForFunction(
    (n) => {
      const row = [...document.querySelectorAll('p > span')].find((span) => span.textContent === `#${n}`);
      const own = row?.closest('div')?.parentElement;
      return own && !own.textContent.includes('Checking this action on chain') && own.querySelector('[data-tone]');
    },
    id,
    { timeout: 180000 }
  );
  await card.scrollIntoViewIfNeeded();
  console.log(`\n=== #${id}\n${(await card.innerText()).trim()}`);
  await card.screenshot({ path: `${OUT}/card-${id}.png` });
}
// All the cards together, once the page has settled: one picture for the write-up.
await page.waitForTimeout(3000);
const boxes = [];
for (const id of ids) {
  const box = await page.locator(`div:has(> p > span:text-is("#${id}"))`).first().locator('..').boundingBox();
  const scroll = await page.evaluate(() => window.scrollY);
  if (box) boxes.push({ ...box, y: box.y + scroll });
}
if (boxes.length) {
  const x = Math.min(...boxes.map((box) => box.x)) - 8;
  const y = Math.min(...boxes.map((box) => box.y)) - 8;
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + 8;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 8;
  await page.screenshot({ path: `${OUT}/cards.png`, fullPage: true, clip: { x, y, width: right - x, height: bottom - y } });
}
await browser.close();
