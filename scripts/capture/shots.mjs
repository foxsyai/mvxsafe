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

// The documentation shows a board, and a board is three real people. The
// pictures are public, so the members are named Alice, Bob and Carol here
// rather than carrying their herotags. A label beats a herotag in the app, so
// seeding these is enough to rename them everywhere in the shots.
const LABELS = {
  erd1etc22n3wel7s452mkvfy2aw3zpef7lmdkkyv9xcryzssdcpahlnsvnzga0: 'Alice',
  erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe: 'Bob',
  erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx: 'Carol'
};

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

// The window is driven by hand, so whatever the page says to its console is the
// only trace of what went wrong in it. Mirrored here, where it can be read.
if (process.env.TRACE) {
  page.on('console', (message) => {
    const kind = message.type();
    if (kind === 'error' || kind === 'warning') console.log(`    [page ${kind}] ${message.text().slice(0, 300)}`);
  });
  page.on('pageerror', (failure) => console.log(`    [page crash] ${String(failure).slice(0, 300)}`));
  page.on('requestfailed', (request) => {
    if (/multiversx|walletconnect|relay/i.test(request.url()))
      console.log(`    [request failed] ${request.method()} ${request.url().slice(0, 120)} ${request.failure()?.errorText ?? ''}`);
  });
}

// Seeding happens on demand rather than at launch, because the first two
// pictures show an empty list and the add form, and an init script would have
// filled the list before they could be taken.
const seed = async () => {
  await page.addInitScript(
    ([safes, labels]) => {
      localStorage.setItem(
        'mvxsafe.savedSafes',
        JSON.stringify(safes.map(([name, address]) => ({ name, address })))
      );
      localStorage.setItem('mvxsafe.labels', JSON.stringify(labels));
    },
    [SAFES, LABELS]
  );
};

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

// Polling with evaluate, NOT waitForFunction: the site's content policy forbids
// evaluating strings (script-src 'self', no unsafe-eval) and waitForFunction
// works that way, so every wait failed instantly and the window closed.
const until = async (fn, label, timeout = 600000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(fn)) return true;
    } catch {
      // mid navigation, try again
    }
    await page.waitForTimeout(1000);
  }
  console.log(`    gave up waiting for ${label}`);
  return false;
};

const settled = () =>
  until(() => !document.body.innerText.includes('Reading '), 'the list to load', 120000);

// FROM and TO pick a slice of the run, so one picture can be retaken without
// sitting through the others. FROM=1 TO=1 needs no wallet at all.
const FROM = Number(process.env.FROM || 1);
const TO = Number(process.env.TO || 6);
console.log(
  `\nSite: ${SITE}\nFollow the orange banner at the top of the Chrome window.` +
    (FROM > 1 || TO < 6 ? `\nSteps ${FROM} to ${TO}.` : '') +
    '\n'
);
await page.goto(SITE, { waitUntil: 'networkidle' });

if (FROM <= 1) {
  // The empty list and the add form, with nobody connected. No wallet is
  // needed for these, so they are filled in and photographed automatically.
  await say('Step 1 of 6: nothing to do, photographing the empty list and the add form.');
  await page.evaluate(() => localStorage.removeItem('mvxsafe.savedSafes'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot('08-empty');

  await page.fill('input[placeholder="Name"]', SAFES[0][0]);
  await page.fill('input[placeholder="erd1..."]', MAIN_SAFE);
  await page.evaluate(() => {
    const form = [...document.querySelectorAll('div')].find((d) =>
      d.innerText?.startsWith('Add a safe')
    );
    if (form) form.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(600);
  await shot('09-add');
}

await seed();
await page.goto(SITE, { waitUntil: 'networkidle' });
await settled();
await page.waitForTimeout(1500);

if (FROM <= 1) {
  await shot('10-list-watching');
}

if (TO <= 1) {
  await say('Done with the list. Closing.', 'ok');
  await page.waitForTimeout(1200);
  await ctx.close().catch(() => {});
  console.log('\nDone. The pictures are in', OUT);
  process.exit(0);
}

// This profile may already hold a connection from an earlier run, in which case
// there is no chooser to photograph and nothing to wait for.
const alreadyConnected = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Disconnect')
);

if (alreadyConnected) {
  await say('Already connected in this profile, skipping the wallet steps.', 'ok');
} else {
  await say(
    'Step 2 of 6: press Connect, then WAIT a moment before picking a wallet, so the chooser can be photographed.'
  );
  // Either the chooser appears and is photographed, or the connection is already
  // through, in which case there is nothing to photograph and waiting for a
  // chooser that has closed would stall the run.
  await until(
    () =>
      document.body.innerText.includes('Connect a wallet') ||
      [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Disconnect'),
    'the wallet chooser',
    300000
  );
  // Photographed at once: the first attempt caught xPortal's QR code instead,
  // because a second and a half was enough to pick a wallet (6 Oct 2026).
  if (await page.evaluate(() => document.body.innerText.includes('Connect a wallet'))) {
    await page.waitForTimeout(250);
    await shot('11-connect-chooser');
  }

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
}

if (FROM <= 2) {
  await say('Connected. Photographing the list as a board member.', 'ok');
  await settled();
  await page.waitForTimeout(2000);
  await shot('12-list-board-member');
}

await say('Step 3 of 6: opening a safe.');
await page.goto(`${SITE}/safe/${MAIN_SAFE}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
if (FROM <= 3) await shot('13-safe-overview');

if (FROM <= 4) {
  await say('Step 4 of 6: the board and the holdings.');
  await page.evaluate(() => {
    const section = [...document.querySelectorAll('section')].find((s) =>
      s.innerText.startsWith('Board')
    );
    if (section) window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - 120);
  });
  await page.waitForTimeout(900);
  await shot('14-board-and-holdings');
}

if (FROM <= 5) {
await say(
  'Step 5 of 6: in Propose an action, put an erd1 address in Recipient and a number in Amount, in that order. Do NOT press Propose.'
);
await page.evaluate(() => window.scrollTo(0, 0));
// Both fields have to hold the right kind of value. The first attempt was
// photographed with the address and the amount swapped, which is exactly the
// mistake a picture in the guide must not teach (Sebastian, 6 Oct 2026).
await until(() => {
  const field = (placeholder) =>
    [...document.querySelectorAll('input')]
      .find((i) => i.placeholder === placeholder)
      ?.value.trim() ?? '';
  const recipient = field('erd1...');
  const amount = field('0.00');
  return /^erd1[a-z0-9]{55,}$/.test(recipient) && /^[0-9][0-9.,]*$/.test(amount);
}, 'the form to be filled correctly');
await page.waitForTimeout(800);
await page.evaluate(() => {
  const panel = [...document.querySelectorAll('section')].find((s) =>
    s.innerText.startsWith('Propose an action')
  );
  if (panel) window.scrollTo(0, panel.getBoundingClientRect().top + window.scrollY - 120);
});
await page.waitForTimeout(600);
await shot('15-propose-form');
}

await say(
  'Step 6 of 6, OPTIONAL: press Propose and confirm in your wallet, to photograph a real pending action with its buttons. Skip it by closing the window.'
);
// What the propose panel is doing, so a press that goes nowhere leaves a trace.
let lastState = '';
const watchPanel = setInterval(async () => {
  try {
    const state = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((b) =>
        /^(Propose|Waiting for your wallet)/.test(b.textContent.trim())
      );
      const red = [...document.querySelectorAll('p')].find((p) =>
        /could not be proposed|Cancelled in your wallet|did not go through|has not answered/.test(
          p.textContent
        )
      );
      return [
        button ? button.textContent.trim() : 'no propose button',
        red ? red.textContent.trim().slice(0, 160) : ''
      ].join(' | ');
    });
    if (state !== lastState) {
      lastState = state;
      console.log(`    [panel] ${state}`);
    }
  } catch {
    // mid navigation
  }
}, 3000);

const proposed = await until(
  () => {
    const text = document.body.innerText;
    return (
      text.includes('Pending actions') &&
      !text.includes('Nothing is waiting for a signature')
    );
  },
  'a pending action',
  900000
);
clearInterval(watchPanel);

if (proposed) {
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const section = [...document.querySelectorAll('section')].find((s) =>
      s.innerText.startsWith('Pending actions')
    );
    if (section) window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - 120);
  });
  await page.waitForTimeout(900);
  if (FROM <= 6) await shot('16-pending-action');

  // The proposer has already signed, so their card shows "Remove my signature".
  // Everybody else sees "Sign", and that is the one picture the guide for
  // signers needs. Taking the signature back produces it, and is the first half
  // of clearing the action anyway.
  await say(
    'Step 7: press "Remove my signature". That is exactly what another board member sees, and I photograph it. Then press Discard.'
  );
  const toSign = await until(
    () =>
      [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Sign') &&
      !document.body.innerText.includes('Nothing is waiting for a signature'),
    'the action with no signatures on it',
    900000
  );
  if (toSign) {
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const section = [...document.querySelectorAll('section')].find((s) =>
        s.innerText.startsWith('Pending actions')
      );
      if (section) window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - 120);
    });
    await page.waitForTimeout(600);
    await shot('17-action-to-sign');
  }
  // With the quorum met the action is ready, and a second button appears. That
  // is the state the guide calls "carry it out", and it needs a second board
  // member, so it is the last thing asked for.
  await say(
    'Step 8: sign with two board members, so the quorum is met. I photograph the moment "Carry it out" appears.'
  );
  const ready = await until(
    () =>
      [...document.querySelectorAll('button')].some(
        (b) => b.textContent.trim() === 'Carry it out'
      ),
    'the quorum to be met',
    1800000
  );
  if (ready) {
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const section = [...document.querySelectorAll('section')].find((s) =>
        s.innerText.startsWith('Pending actions')
      );
      if (section) window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - 120);
    });
    await page.waitForTimeout(600);
    await shot('18-ready-to-carry-out');
  }
  await say('Photographed. Carry it out, or Discard, then close the window.', 'ok');
  await until(() => false, 'you to close the window', 1800000);
}

await ctx.close().catch(() => {});
console.log('\nDone. The pictures are in', OUT);
