// The pictures of /guide, taken from the live site with real wallets.
//
//   node scripts/capture/guide.mjs              all steps
//   FROM=12 node scripts/capture/guide.mjs      from a given picture on
//
// A Chrome window opens with an orange banner across the top saying what to do.
// The script fills in every form itself and photographs each state as soon as
// it appears; a person only acts where a wallet has to sign. Five transactions
// in all, on the test safe, from two board members: "Alice" signs with xPortal,
// "Bob" with the web wallet.
//
// Only the test safe appears, as "Team safe", and every board member carries a
// neutral name (Sebastian, 7 Oct 2026): the guide is public.
//
// NOTHING IS SIGNED BY THIS SCRIPT. It fills forms, waits and photographs.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const SITE = process.env.SITE || 'https://mvxsafe.io';
const OUT = process.env.OUT || 'public/shots/';
const PROFILE = `${homedir()}/.mvxsafe-shots-profile`;
const FROM = Number(process.env.FROM || 1);

const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';
const ALICE = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const BOB = 'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4';
const CAROL = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const DAVE = 'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd';
const STRANGER = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const LABELS = { [ALICE]: 'Alice', [BOB]: 'Bob', [CAROL]: 'Carol', [DAVE]: 'Dave' };
const SAFES = [{ name: 'Team safe', address: SAFE }];

mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1366, height: 900 },
  deviceScaleFactor: 2,
  // Chrome on this laptop runs under XWayland; its Qt plugin exists for xcb only.
  args: ['--ozone-platform=x11'],
  env: { ...process.env, QT_QPA_PLATFORM: 'xcb' }
});
const page = ctx.pages()[0] || (await ctx.newPage());

// --- the banner ---------------------------------------------------------------

let banner = { text: '', tone: 'ask' };
const drawBanner = () =>
  page
    .evaluate(({ text, tone }) => {
      let bar = document.getElementById('shot-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'shot-bar';
        bar.style.cssText =
          'position:fixed;inset:0 0 auto 0;z-index:99999;padding:14px 18px;font:600 15px system-ui;text-align:center';
        document.body.appendChild(bar);
      }
      bar.style.background = tone === 'ok' ? '#123d1c' : '#FF6E0A';
      bar.style.color = tone === 'ok' ? '#b8f5c7' : '#1a0d00';
      bar.textContent = text;
      bar.style.display = 'block';
    }, banner)
    .catch(() => {});

const say = async (text, tone = 'ask') => {
  banner = { text, tone };
  console.log(`>>> ${text}`);
  await drawBanner();
};

// Polled with evaluate, never waitForFunction: the site's content policy forbids
// evaluating strings, which is how waitForFunction works. The banner is drawn
// again on every poll, so a reload (a wallet switch) does not lose it.
const until = async (fn, arg, label, timeout = 900000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(fn, arg)) return true;
    } catch {
      // mid navigation
    }
    await drawBanner();
    await page.waitForTimeout(800);
  }
  console.log(`    gave up waiting for ${label}`);
  return false;
};

// Every function passed to `until` runs in the page, so it must stand alone.
const hasText = (needle) => document.body.innerText.includes(needle);
/** Text inside the wallet panel too, which lives in shadow roots. */
const deepText = (needle) => {
  const walk = (root) =>
    [...root.querySelectorAll('*')].some(
      (el) => el.shadowRoot && (el.shadowRoot.textContent.includes(needle) || walk(el.shadowRoot))
    );
  return document.body.innerText.includes(needle) || walk(document);
};
const buttonEnabled = (name) =>
  [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === name && !b.disabled);

/** Photographs the window with the banner hidden; `section` scrolls to it first. */
const shot = async (name, section) => {
  const number = Number(name.slice(0, 2));
  if (number < FROM) return;
  if (section) {
    await page.evaluate((start) => {
      const target = [...document.querySelectorAll('section, h2, h1')].find((el) =>
        el.innerText.trim().startsWith(start)
      );
      if (target) window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - 110);
    }, section);
    await page.waitForTimeout(600);
  }
  await page.evaluate(() => {
    const bar = document.getElementById('shot-bar');
    if (bar) bar.style.display = 'none';
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${name}.png` });
  await drawBanner();
  console.log(`    saved ${OUT}${name}.png`);
};

const go = async (path) => {
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle' });
  await drawBanner();
};

const seed = (safes, labels) =>
  page.evaluate(
    ([safes, labels]) => {
      localStorage.setItem('mvxsafe.savedSafes', JSON.stringify(safes));
      localStorage.setItem('mvxsafe.labels', JSON.stringify(labels));
      sessionStorage.removeItem('mvxsafe.cards');
    },
    [safes, labels]
  );

const connectedAs = (name) =>
  document.body.innerText.includes('Disconnect') &&
  Boolean(document.querySelector('header')?.innerText.includes(name));

const fill = async (placeholder, value, nth = 0) =>
  page.locator(`input[placeholder="${placeholder}"]`).nth(nth).fill(value);

// Buttons by their exact name: "Propose" would also match "Add proposer".
const button = (name) => page.getByRole('button', { name, exact: true });

// Each phase runs only when FROM reaches into it, so a restart from a later
// picture does not ask for wallets that are already connected.
const phase = (first, last) => FROM <= last && first >= 0;

console.log(`\nSite: ${SITE}. Follow the orange banner in the Chrome window.\n`);
await go('/');

// --- 1. Without a wallet (pictures 1 to 4) ------------------------------------

if (phase(1, 4)) {
  if (await page.evaluate(hasText, 'Disconnect')) {
    await say('Please press Disconnect first: the first pictures are taken without a wallet.');
    await until(() => !document.body.innerText.includes('Disconnect'), null, 'a disconnect');
  }
  await say('Nothing to do: photographing the site without a wallet.', 'ok');
  await seed([], LABELS);
  await go('/');
  await page.waitForTimeout(1200);
  await shot('01-empty');

  await fill('Name', 'Team safe');
  await fill('erd1...', SAFE);
  await page.waitForTimeout(400);
  await shot('02-add', 'Add a safe');

  await seed(SAFES, LABELS);
  await go('/');
  // The card's counts are in: a number under "Proposed so far".
  await until(() => /Proposed so far\s*\d/.test(document.body.innerText), null, 'the card', 120000);
  await page.waitForTimeout(800);
  await shot('03-list-read-only');

  await go(`/safe/${SAFE}`);
  await until(hasText, 'Board and proposers', 'the safe', 120000);
  await until(() => !document.body.innerText.includes('Loading'), null, 'the reads', 120000);
  await page.waitForTimeout(1000);
  await shot('04-safe-read-only');
} else {
  await seed(SAFES, LABELS);
  await go('/');
}

// --- 2. Connected as Alice (pictures 5 to 11) ---------------------------------

if (phase(5, 5)) {
  await say('Press Connect, then WAIT a second before choosing xPortal, so the chooser can be photographed. Connect as Alice (your own wallet).');
  await until(
    (needle) => {
      const walk = (root) =>
        [...root.querySelectorAll('*')].some(
          (el) => el.shadowRoot && (el.shadowRoot.textContent.includes(needle) || walk(el.shadowRoot))
        );
      return walk(document) || document.body.innerText.includes('Disconnect');
    },
    'Connect a wallet',
    'the wallet chooser'
  );
  if (await page.evaluate(deepText, 'Connect a wallet')) {
    await page.waitForTimeout(250);
    await shot('05-connect');
  }
}
if (!(await page.evaluate(connectedAs, 'Alice'))) {
  await say('Connect as Alice (your own wallet, xPortal). I am waiting.');
}
await until(connectedAs, 'Alice', 'Alice to connect');
await say('Connected as Alice. Photographing.', 'ok');

if (phase(6, 10)) {
  await go('/');
  await until(() => document.body.innerText.includes('board member') && /Proposed so far\s*\d/.test(document.body.innerText), null, 'the badge', 120000);
  await page.waitForTimeout(800);
  await shot('06-list-board-member');

  await go(`/safe/${SAFE}`);
  await until(() => document.body.innerText.includes('a board member here') && !document.body.innerText.includes('Loading'), null, 'the safe', 120000);
  await page.waitForTimeout(1000);
  await shot('07-safe');
  await shot('08-board-holdings', 'Board and proposers');

  await go('/create');
  await fill('Treasury', 'Team safe');
  await fill('erd1...', ALICE, 0);
  await fill('erd1...', BOB, 1);
  await fill('erd1...', CAROL, 2);
  await page.waitForTimeout(500);
  await shot('09-create');

  // A membership change says what it does while it is typed; nothing is proposed.
  await go(`/safe/${SAFE}`);
  await until(hasText, 'Propose an action', 'the propose form', 120000);
  await button('Add proposer').click();
  await fill('erd1...', ALICE);
  await page.waitForTimeout(500);
  await shot('10-membership-note', 'Propose an action');
}

await go(`/safe/${SAFE}`);
await until(hasText, 'Propose an action', 'the propose form', 120000);

if (phase(11, 11)) {
  // A change the contract would only refuse later is refused here at once.
  await button('Remove member').click();
  await fill('erd1...', STRANGER);
  await button('Propose').click();
  await page.waitForTimeout(500);
  await shot('11-refused', 'Propose an action');
  await fill('erd1...', '');
}

// --- 3. Discard (picture 12) --------------------------------------------------

if (phase(12, 12)) {
  if (!(await page.evaluate(buttonEnabled, 'Remove my signature'))) {
    await button('Send tokens').click();
    await page.locator('select').first().selectOption('FOXSY-5d5f3e');
    await fill('erd1...', DAVE);
    await fill('0.00', '1');
    await say('Press Propose and approve in xPortal: a small action, to be discarded right after.');
    await until(buttonEnabled, 'Remove my signature', 'a pending action Alice signed');
  }
  await say('Press "Remove my signature" on the pending action and approve in xPortal.');
  await until(buttonEnabled, 'Discard', 'Discard to switch on');
  await page.waitForTimeout(800);
  await shot('12-discard-ready', 'Pending actions');
  await say('Press Discard and approve in xPortal.');
  await until(
    () => !document.body.innerText.includes('Remove my signature') && !/\b0 of \d signatures/.test(document.body.innerText),
    null,
    'the discard'
  );
}

// --- 4. A payment, proposed by Alice (pictures 13 and 14) ---------------------

if (phase(13, 14)) {
  await say('Filling in a payment of 10 FOXSY to Dave.', 'ok');
  // The page waits for the last transaction to be confirmed before anything
  // else can be proposed; the picture should not show that wait.
  await until(buttonEnabled, 'Propose', 'the propose form to unlock', 120000);
  await button('Send tokens').click();
  await page.locator('select').first().selectOption('FOXSY-5d5f3e');
  await fill('erd1...', DAVE);
  await fill('0.00', '10');
  await page.waitForTimeout(500);
  await shot('13-propose-form', 'Propose an action');
  await say('Press Propose and approve in xPortal.');
  await until(() => /Send 10 FOXSY-5d5f3e[\s\S]*1 of \d signatures/.test(document.body.innerText), null, 'the proposal');
  await page.waitForTimeout(1500);
  await shot('14-pending-proposer', 'Pending actions');
}

// --- 5. Bob signs and carries it out (pictures 15 to 18) ----------------------

if (phase(15, 18)) {
  await say('Now switch wallets: press Disconnect, then Connect as Bob with the MultiversX Web Wallet.');
  await until(connectedAs, 'Bob', 'Bob to connect');
  await say('Connected as Bob. Photographing the list.', 'ok');
  await go('/');
  await until(hasText, 'needs you', 'the "needs you" card', 120000);
  await page.waitForTimeout(800);
  await shot('15-list-needs-you');

  await go(`/safe/${SAFE}`);
  await until(buttonEnabled, 'Sign', 'the Sign button', 120000);
  await page.waitForTimeout(800);
  await shot('16-sign', 'Pending actions');
  await say('Press Sign and approve in the web wallet (with the 2FA code).');
  await until(buttonEnabled, 'Carry it out', 'the quorum');
  await page.waitForTimeout(800);
  await shot('17-ready', 'Pending actions');
  await say('Press "Carry it out" and approve in the web wallet.');
  await until(() => !document.body.innerText.includes('Send 10 FOXSY-5d5f3e'), null, 'the payment to be carried out');
  await page.waitForTimeout(3000);
  await shot('18-history', 'History');
}

await say('All pictures taken. You can close the window.', 'ok');
console.log('\nDone. Turn them into JPEGs with ./scripts/capture/to-web.sh');
await until(() => false, null, 'the window to close', 600000);
await ctx.close().catch(() => {});
