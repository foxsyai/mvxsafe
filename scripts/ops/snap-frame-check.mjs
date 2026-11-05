#!/usr/bin/env node
// The MetaMask Snap can open on the site: the regression check for OPS-09.
//
// MetaMask was hidden from the connect panel while the content policy refused
// the Snap's iframe (ops audit OPS-09, 7 Oct 2026, the proof is
// src/__audit__/ops/proofs/OPS-09-blocked-providers.mjs). It is offered again,
// with the Snap's origin added to frame-src. This opens the panel on SITE and
// fails unless it offers exactly the five wallets, and pressing MetaMask Snap
// loads the Snap's frame from the network's origin without a single content
// policy violation in the page, whatever the directive.
//
// Read-only: headless Chrome with no wallet, nothing is connected or signed.
// Without MetaMask installed the panel also opens MetaMask's store page in a
// new tab, which is closed.
//
//   SITE=https://devnet.mvxsafe.io node scripts/ops/snap-frame-check.mjs
//   SITE=https://mvxsafe.io node scripts/ops/snap-frame-check.mjs
//
// SNAP overrides the origin the frame must come from; by default it is the
// devnet Snap for a devnet site and the mainnet Snap otherwise. CHROMIUM points
// at a browser binary when Chrome itself is not installed. Exit 0 when all of
// the above holds, 1 otherwise.
import { chromium } from '@playwright/test';

const SITE = process.env.SITE || 'https://mvxsafe.io';
const SNAP =
  process.env.SNAP ||
  (new URL(SITE).hostname.startsWith('devnet.')
    ? 'https://devnet-snap.multiversx.com'
    : 'https://snap.multiversx.com');
const WALLETS = [
  'xPortal App',
  'MultiversX Wallet Extension',
  'Ledger',
  'MultiversX Web Wallet',
  'MetaMask Snap'
];

const browser = await chromium.launch(
  process.env.CHROMIUM
    ? { executablePath: process.env.CHROMIUM, headless: true }
    : { channel: 'chrome', headless: true }
);
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  ignoreHTTPSErrors: new URL(SITE).hostname === 'localhost'
});
// Every frame records its own violations; the page's are the ones that count.
await context.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolations.push({
      directive: e.effectiveDirective,
      blocked: e.blockedURI
    });
  });
});
const page = await context.newPage();
context.on('page', async (opened) => {
  await opened.waitForLoadState('domcontentloaded').catch(() => {});
  console.log(`a new tab opened: ${opened.url() || '(blank)'}, closed`);
  await opened.close().catch(() => {});
});
const policyErrors = [];
page.on('console', (m) => {
  if (/Content Security Policy/i.test(m.text()))
    policyErrors.push(m.text().slice(0, 240));
});
const snapResponses = [];
page.on('response', (r) => {
  if (r.url().startsWith(SNAP)) snapResponses.push(`${r.status()} ${r.url()}`);
});

const failures = [];
const response = await page.goto(SITE, { waitUntil: 'networkidle' });
const policy = response.headers()['content-security-policy'] || '';
console.log(`site: ${SITE}`);
console.log(`policy ${policy.match(/frame-src [^;]*/)?.[0] || 'has no frame-src'}`);

await page
  .getByRole('button', { name: 'Connect', exact: true })
  .first()
  .click();
await page.waitForTimeout(2500);

const texts = await page.evaluate(() => {
  const seen = new Set();
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot);
      const t = (el.childElementCount === 0 ? el.textContent : '').trim();
      if (t && t.length < 40) seen.add(t);
    }
  };
  walk(document);
  return [...seen];
});
const offered = texts.filter((t) =>
  /wallet|xportal|ledger|metamask|passkey|extension/i.test(t)
);
console.log(`chooser: ${offered.join(' | ')}`);
const missing = WALLETS.filter((w) => !texts.includes(w));
if (missing.length) failures.push(`not offered: ${missing.join(', ')}`);
if (texts.includes('Passkey')) failures.push('Passkey is offered');

if (texts.includes('MetaMask Snap')) {
  await page.evaluate(() => (window.__cspViolations.length = 0));
  await page.getByText('MetaMask Snap', { exact: true }).first().click();
  let frame;
  for (let i = 0; i < 30 && !frame; i++) {
    await page.waitForTimeout(500);
    frame = page.frames().find((f) => f.url().startsWith(SNAP));
  }
  await page.waitForTimeout(3000);
  const violations = await page.evaluate(() => window.__cspViolations);
  console.log(`clicked "MetaMask Snap": page violations = ${JSON.stringify(violations)}`);
  console.log(`snap responses: ${snapResponses.slice(0, 3).join(', ') || 'none'}`);
  if (violations.length)
    failures.push(`content policy violations: ${JSON.stringify(violations)}`);
  if (!frame) failures.push(`no frame from ${SNAP} loaded`);
  else {
    console.log(`snap frame: ${frame.url()}`);
    const inside = await frame
      .evaluate(() => window.__cspViolations)
      .catch(() => null);
    console.log(`the frame's own violations (its own policy): ${JSON.stringify(inside)}`);
  }
}
await browser.close();

if (policyErrors.length)
  console.log('policy messages: ' + policyErrors.slice(0, 5).join(' || '));
if (failures.length) {
  console.log(`\nFAIL: ${failures.join('; ')}`);
  process.exit(1);
}
console.log(`\nOK: five wallets offered, the Snap frame loads from ${SNAP}, no violation`);
