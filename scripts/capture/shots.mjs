// Documentation screenshots from the real site, with a real wallet.
//
//   node scripts/capture/shots.mjs            mainnet, the live site
//   SITE=https://devnet.mvxsafe.io node ...         the devnet copy
//
// It opens a Chrome window, tells you what to do in an orange banner across the
// top of the page, and moves on by itself as soon as it sees the state it needs.
// The browser profile lives in ~/.mvxsafe-shots-profile, so a wallet extension
// installed there, or an xPortal session, is remembered between runs.
//
// NOTHING IS SIGNED OR SENT BY THIS SCRIPT. It watches and photographs. The one
// step that needs a transaction is optional and you carry it out yourself in
// your wallet.
//
// Launch settings are taken from next-foxleague/scratchpad/manual-shots.mjs,
// which already solved this on the same laptop: Chrome runs on X11 (XWayland)
// because its Qt theme plugin exists only for xcb here.
import { chromium } from '/home/sebastian/FOXSY/next-foxleague/frontend/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const SITE = process.env.SITE || 'https://mvxsafe.io';
const OUT = process.env.OUT || 'public/shots/';
const PROFILE = `${homedir()}/.mvxsafe-shots-profile`;

// The Foundation's safes, so the list is populated before anything is captured.
const SAFES = [
  ['Treasury', 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p'],
  ['Team', 'erd1qqqqqqqqqqqqqpgqt3kpgt5rfg9mrd3vpu6u6cxx758lkrgz0cqqcy9c32'],
  ['Vesting', 'erd1qqqqqqqqqqqqqpgqjvg2qnd47xhyqwhemw304qu5zat7uxaz5m6q07rtdp'],
  ['Ecosystem', 'erd1qqqqqqqqqqqqqpgqsm05k6e468xu065p2u46f938k2ee6l7nqvfq6xnmdh'],
  ['Community', 'erd1qqqqqqqqqqqqqpgqz4v88tqd6j3ntxafg5ynyy8028vaf53rx0kqf5gnre'],
  ['Liquidity', 'erd1qqqqqqqqqqqqqpgq3evw5eguak04xwqkkdwdsxynd4s2e32h0jasyh7958'],
  ['Advisors', 'erd1qqqqqqqqqqqqqpgq27hwaxqf2gh2r7xqmldlvla6mjzc78lp98nqvuzq39']
];
const MAIN_SAFE = SAFES[0][1];

mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1366, height: 900 },
  deviceScaleFactor: 2,
  args: ['--ozone-platform=x11'],
  env: { ...process.env, QT_QPA_PLATFORM: 'xcb' }
});
const page = ctx.pages()[0] || (await ctx.newPage());

await page.addInitScript((safes) => {
  localStorage.setItem(
    'mvxsafe.savedSafes',
    JSON.stringify(safes.map(([name, address]) => ({ name, address })))
  );
}, SAFES);

const say = async (text, tone = 'ask') => {
  console.log(`>>> ${text}`);
  await page
    .evaluate(
      ([text, tone]) => {
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
      },
      [text, tone]
    )
    .catch(() => {});
};

/** Photographs the page with the instruction banner hidden. */
const shot = async (name) => {
  await page.evaluate(() => {
    const bar = document.getElementById('shot-bar');
    if (bar) bar.style.display = 'none';
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + name + '.png' });
  await page.evaluate(() => {
    const bar = document.getElementById('shot-bar');
    if (bar) bar.style.display = 'block';
  });
  console.log(`    saved ${OUT}${name}.png`);
};

const until = async (fn, label, timeout = 600000) => {
  try {
    await page.waitForFunction(fn, null, { timeout, polling: 1000 });
    return true;
  } catch {
    console.log(`    gave up waiting for ${label}`);
    return false;
  }
};

const settled = () =>
  until(() => !document.body.innerText.includes('Reading '), 'the list to load', 120000);

console.log(`\nSite: ${SITE}\nFollow the orange banner at the top of the Chrome window.\n`);
await page.goto(SITE, { waitUntil: 'networkidle' });
await settled();
await page.waitForTimeout(1500);

await say('Step 1 of 6: nothing to do, photographing the list.');
await shot('10-list-watching');

await say('Step 2 of 6: press Connect and choose your wallet.');
await until(() => document.body.innerText.includes('Connect a wallet'), 'the wallet chooser', 300000);
await page.waitForTimeout(1200);
await shot('11-connect-chooser');

await say('Finish connecting in your wallet. I am waiting.');
const connected = await until(
  () => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Disconnect'),
  'the wallet to connect'
);
if (!connected) {
  console.log('No wallet connected, stopping here.');
  await ctx.close();
  process.exit(0);
}

await say('Connected. Photographing the list as a board member.', 'ok');
await settled();
await page.waitForTimeout(2000);
await shot('12-list-board-member');

await say('Step 3 of 6: opening a safe.');
await page.goto(`${SITE}/safe/${MAIN_SAFE}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
await shot('13-safe-overview');

await say('Step 4 of 6: the board and the holdings.');
await page.evaluate(() => {
  const section = [...document.querySelectorAll('section')].find((s) =>
    s.innerText.startsWith('Board')
  );
  if (section) window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - 120);
});
await page.waitForTimeout(900);
await shot('14-board-and-holdings');

await say(
  'Step 5 of 6: in Propose an action, choose a kind, fill the fields. Do NOT press Propose yet.'
);
await page.evaluate(() => window.scrollTo(0, 0));
await until(
  () =>
    [...document.querySelectorAll('input')].some(
      (i) => (i.placeholder === '0.00' || i.placeholder === 'erd1...') && i.value.trim().length > 3
    ),
  'the form to be filled'
);
await page.waitForTimeout(800);
await page.evaluate(() => {
  const panel = [...document.querySelectorAll('section')].find((s) =>
    s.innerText.startsWith('Propose an action')
  );
  if (panel) window.scrollTo(0, panel.getBoundingClientRect().top + window.scrollY - 120);
});
await page.waitForTimeout(600);
await shot('15-propose-form');

await say(
  'Step 6 of 6, OPTIONAL: press Propose and confirm in your wallet, to photograph a real pending action with its buttons. Skip it by closing the window.'
);
const proposed = await until(
  () =>
    document.body.innerText.includes('signatures') &&
    !document.body.innerText.includes('Nothing is waiting for a signature'),
  'a pending action',
  900000
);
if (proposed) {
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const section = [...document.querySelectorAll('section')].find((s) =>
      s.innerText.startsWith('Pending actions')
    );
    if (section) window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - 120);
  });
  await page.waitForTimeout(900);
  await shot('16-pending-action');
  await say(
    'Photographed. To clear it: Remove my signature, then Discard. Close the window when you are done.',
    'ok'
  );
  await until(() => false, 'you to close the window', 900000);
}

await ctx.close().catch(() => {});
console.log('\nDone. The pictures are in', OUT);
