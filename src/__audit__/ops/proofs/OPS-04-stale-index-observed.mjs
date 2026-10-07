#!/usr/bin/env node
// OPS-04, observed in a real browser: headless Chrome loads https://mvxsafe.io/,
// leaves, and comes back a few seconds later. With no Cache-Control on
// index.html the second visit is answered from the disk cache without asking
// the server (same Date header, fromDiskCache), which is exactly the state a
// signer is in after a deploy: the old index.html, pointing at a bundle that
// `rsync --delete` removed.
//
// Read-only. Exit 1 when the second navigation is served from cache without
// revalidation (bug), 0 when Chrome went back to the server (fixed: no-cache).
//
//   node src/__audit__/ops/proofs/OPS-04-stale-index-observed.mjs
import { chromium } from '/home/sebastian/FOXSY/next-foxleague/frontend/node_modules/playwright/index.mjs';

const URL = process.env.URL || 'https://mvxsafe.io/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
const docs = [];
cdp.on('Network.responseReceived', (e) => {
  if (e.type !== 'Document') return;
  const h = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
  docs.push({
    url: e.response.url,
    status: e.response.status,
    fromDiskCache: !!e.response.fromDiskCache,
    date: h.date,
    cacheControl: h['cache-control'] ?? '(absent)'
  });
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(4000);
await page.goto('about:blank');
await page.goto(URL, { waitUntil: 'load' });
await browser.close();

const [first, second] = docs.filter((d) => d.url === URL);
console.log('first visit : ', first);
console.log('second visit: ', second);
if (!first || !second) {
  console.log('could not observe both navigations; nothing proven');
  process.exit(2);
}
const stale = second.fromDiskCache && second.status === 200 && second.date === first.date;
if (stale) {
  console.log('\nBUG (OPS-04): the second visit reused index.html from the disk cache without revalidation');
  process.exit(1);
}
console.log('\nOK: the browser went back to the server for index.html');
