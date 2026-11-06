#!/usr/bin/env node
// SNP-03: the Snap's page is a visible, clickable frame at the foot of every
// page of the site while MetaMask is in use.
//
// sdk-dapp's iframe provider appends a plain <iframe> to the body for the
// network's Snap origin, with no size, style, sandbox or allow attribute, and
// nothing in the app's stylesheet touches it. The browser gives such a frame
// its default 300 by 150 pixels, laid out after the app's own content, taking
// pointer events, for the whole session. The genuine page draws nothing in it,
// so a signer sees only a blank strip. Whoever controls that origin, or a path
// to it, gets a box inside the app's page in which to draw text and take a
// click, and a click in a cross-origin frame is what lets it open a tab or move
// the whole tab elsewhere.
//
// Read-only: headless Chrome with no wallet, nothing is connected or signed.
// Without MetaMask the site also opens MetaMask's store page in a new tab,
// which is closed. Exit 1 while the frame is laid out with a size, displayed,
// visible and taking pointer events; exit 0 once it is hidden (no box, or
// display none, or visibility hidden, or pointer-events none).
//
//   SITE=https://devnet.mvxsafe.io node src/__audit__/nov06/snap/proofs/SNP-03.mjs
//   SITE=https://mvxsafe.io node src/__audit__/nov06/snap/proofs/SNP-03.mjs
//   SITE=https://localhost:4331 SNAP_ORIGIN=https://devnet-snap.multiversx.com node ... (a devnet preview)
import { chromium } from '@playwright/test';

// SNAP_ORIGIN overrides the origin the frame must come from, for a local
// preview. (Not SNAP: on a desktop that runs a snap-packaged terminal or
// editor, SNAP is already set to that package's path.)
const SITE = process.env.SITE || 'https://devnet.mvxsafe.io';
const SNAP =
  process.env.SNAP_ORIGIN ||
  (new URL(SITE).hostname.startsWith('devnet.')
    ? 'https://devnet-snap.multiversx.com'
    : 'https://snap.multiversx.com');

const browser = await chromium.launch(
  process.env.CHROMIUM
    ? { executablePath: process.env.CHROMIUM, headless: true }
    : { channel: 'chrome', headless: true }
);
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  ignoreHTTPSErrors: new URL(SITE).hostname === 'localhost'
});
const page = await context.newPage();
// The store tab that opens without MetaMask, closed; never the page itself.
context.on('page', async (opened) => {
  if (opened === page) return;
  await opened.waitForLoadState('domcontentloaded').catch(() => {});
  await opened.close().catch(() => {});
});

await page.goto(SITE, { waitUntil: 'load' });
const connect = page
  .getByRole('button', { name: 'Connect', exact: true })
  .first();
await connect.waitFor({ timeout: 30000 });
await connect.click();
await page.waitForTimeout(2000);
await page.getByText('MetaMask Snap', { exact: true }).first().click();

// The element is what counts; its page may take a while to arrive.
await page
  .locator('#mx-iframe-wallet')
  .waitFor({ state: 'attached', timeout: 60000 })
  .catch(() => {});
let frame;
for (let i = 0; i < 60 && !frame; i++) {
  await page.waitForTimeout(500);
  frame = page.frames().find((f) => f.url().startsWith(SNAP));
}
await page.waitForTimeout(1500);

const found = await page.evaluate(() => {
  const iframe = document.getElementById('mx-iframe-wallet');
  if (!iframe) return null;
  const rect = iframe.getBoundingClientRect();
  const shown = (element) => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };
  let displayed = true;
  for (let el = iframe; el; el = el.parentElement) {
    if (!shown(el)) displayed = false;
  }
  return {
    src: iframe.getAttribute('src'),
    width: rect.width,
    height: rect.height,
    top: rect.top,
    displayed,
    pointerEvents: getComputedStyle(iframe).pointerEvents,
    sandbox: iframe.getAttribute('sandbox'),
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: innerHeight
  };
});
await browser.close();

console.log(`site: ${SITE}`);
console.log(
  `snap frame: ${frame ? `${frame.url()} loaded` : 'page not yet loaded'}`
);
console.log(`frame element: ${JSON.stringify(found)}`);

if (!found || !String(found.src).startsWith(SNAP)) {
  console.log(`\nFAIL: no frame for ${SNAP} was added, so nothing can be said`);
  process.exit(1);
}
const visible =
  found.width > 0 &&
  found.height > 0 &&
  found.displayed &&
  found.pointerEvents !== 'none';
if (visible) {
  console.log(
    `\nBUG (SNP-03): the Snap's frame is a ${Math.round(found.width)}x${Math.round(found.height)} box laid out at ${Math.round(found.top)} px, displayed and taking clicks`
  );
  process.exit(1);
}
console.log(
  '\nOK: the Snap frame loads but is hidden from view and from clicks'
);
