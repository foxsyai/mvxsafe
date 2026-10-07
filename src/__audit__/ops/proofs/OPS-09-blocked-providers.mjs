#!/usr/bin/env node
// OPS-09: the wallet chooser offers two providers the content policy cannot
// serve.
//
// The app does not pass `allowedProviders` to UnlockPanelManager, so sdk-dapp's
// panel lists everything it knows: xPortal, the extension, Ledger, the web
// wallet, and also "MetaMask Snap" and "Passkey". MetaMask Snap is an iframe
// provider (an iframe to https://snap.multiversx.com) and the live CSP allows
// `frame-src https://verify.walletconnect.com https://verify.walletconnect.org`
// only: the browser refuses the frame and the option is dead, with no message a
// signer could act on. Passkey is offered too and is clicked for completeness;
// on 7 Oct 2026 it produced no violation within the wait, so only MetaMask
// Snap is the proven case. The Connect tooltip names only the four that work.
//
// Read-only: headless Chrome on the live site, nothing is connected or signed.
// Exit 1 when the chooser offers a provider whose frame the CSP then blocks
// (bug: either drop them with allowedProviders or allow their hosts in
// frame-src), 0 otherwise.
//
//   node src/__audit__/ops/proofs/OPS-09-blocked-providers.mjs
import { chromium } from '@playwright/test';

const SITE = process.env.SITE || 'https://mvxsafe.io';
const SUSPECTS = ['MetaMask Snap', 'Passkey'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await page.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolations.push({ directive: e.effectiveDirective, blocked: e.blockedURI });
  });
});
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});

await page.goto(SITE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Connect', exact: true }).first().click();
await page.waitForTimeout(2500);

const offered = await page.evaluate(() => {
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
const suspectsOffered = SUSPECTS.filter((s) => offered.includes(s));
console.log(`chooser texts: ${offered.filter((t) => /wallet|xportal|ledger|metamask|passkey|extension/i.test(t)).join(' | ')}`);
console.log(`offered iframe providers: ${suspectsOffered.join(', ') || 'none'}`);

const blocked = [];
for (const name of suspectsOffered) {
  await page.evaluate(() => (window.__cspViolations.length = 0));
  await page.getByText(name, { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(3000);
  const violations = await page.evaluate(() => window.__cspViolations);
  console.log(`clicked "${name}": CSP violations = ${JSON.stringify(violations)}`);
  if (violations.some((v) => v.directive === 'frame-src')) blocked.push(name);
  // back to the chooser for the next one
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Connect', exact: true }).first().click();
  await page.waitForTimeout(2000);
}
await browser.close();

if (consoleErrors.length) console.log('console errors: ' + consoleErrors.slice(0, 5).join(' || '));
if (blocked.length) {
  console.log(`\nBUG (OPS-09): offered but blocked by frame-src: ${blocked.join(', ')}`);
  process.exit(1);
}
console.log('\nOK: every offered provider can open what it needs');
