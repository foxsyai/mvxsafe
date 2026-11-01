// The pictures of /guide, taken from the live devnet site with throwaway keys.
//
//   node scripts/capture/guide.mjs                 all steps
//   FROM=12 node scripts/capture/guide.mjs         from a given picture on
//   ONLY=4,8,19 node scripts/capture/guide.mjs     just those pictures
//   CHROMIUM=<path> node scripts/capture/guide.mjs another browser
//   ./scripts/capture/to-web.sh                    then, for the JPEGs the guide loads
//
// It runs headless with no person at hand. The wallet is a provider registered on
// window.multiversx; its signatures are made here in node, so no key enters the
// page. Keys live in ~/.mvxsafe-devnet, devnet only, no value, never in git. It
// refuses to sign for any other chain or any other sender, and no mainnet safe or
// wallet appears in a picture. Six transactions in all, on the test safe, from two
// board members: three by "Alice" to discard a small payment, one by her and two by
// "Bob" for a payment from proposal to history.
//
// Pictures 1 to 5 use a browser without that provider: the wallet chooser would
// list it.
import { Account, Address, ApiNetworkProvider, Transaction } from '@multiversx/sdk-core';
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const SITE = 'https://devnet.mvxsafe.io';
const API = 'https://devnet-api.multiversx.com';
const OUT = process.env.OUT || 'public/shots/';
const LONG = 180000;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(Number)) : null;
const FROM = Number(process.env.FROM || (ONLY ? Math.min(...ONLY) : 1));
const TO = Number(process.env.TO || (ONLY ? Math.max(...ONLY) : 21));
/** Whether picture n is to be taken in this run. */
const wanted = (n) => n >= FROM && n <= TO && (!ONLY || ONLY.has(n));
// Each phase runs only when the pictures asked for reach into it.
const phase = (first, last) => FROM <= last && first <= TO;

// The rehearsal safe of docs/upgrade-and-calls.md: 2 of 3, in its own hands, owning
// a devnet contract, so the call and upgrade forms have something real to read.
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const OWNED = 'erd1qqqqqqqqqqqqqpgqntmhxqa29ar4juhlprjjxaq790ykcj3uaujq2l9dzg';
const SOURCE = 'erd1qqqqqqqqqqqqqpgqsy2ept5xx2cprx3htj0l5lwkk52hh9amxezsygtpgl';
// A contract on devnet that runs some other code.
const OTHER_CODE = 'erd1qqqqqqqqqqqqqpgqt7gkxh4a4rqsunake3prr3s8p7wnp4wjmg8sv42dpy';
const TOKEN = 'TSAFED-e52b18';

const load = (name) =>
  Account.newFromMnemonic(readFileSync(`${homedir()}/.mvxsafe-devnet/${name}.mnemonic`, 'utf8').trim());
const keys = { alice: load('alice'), bob: load('bob'), carol: load('carol') };
const ALICE = keys.alice.address.toBech32();
const BOB = keys.bob.address.toBech32();
const CAROL = keys.carol.address.toBech32();
const DAVE = load('dave').address.toBech32();
const STRANGER = load('erin').address.toBech32();
const LABELS = { [ALICE]: 'Alice', [BOB]: 'Bob', [CAROL]: 'Carol', [DAVE]: 'Dave' };
const SAFES = [{ name: 'Team safe', address: SAFE }];

const api = new ApiNetworkProvider(API, { clientName: 'mvxsafe-guide-pictures' });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (text) => console.log(`>>> ${text}`);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
let page;

const newPage = async (account) => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 2
  });
  if (account) {
    const address = account.address.toBech32();
    await context.exposeFunction('__guideSign', async (plains) => {
      const signatures = [];
      for (const plain of plains) {
        if (plain?.chainID !== 'D' || plain?.sender !== address) {
          throw new Error(`refused: chain ${plain?.chainID}, sender ${plain?.sender}`);
        }
        const signature = await account.signTransaction(Transaction.newFromPlainObject(plain));
        signatures.push(Buffer.from(signature).toString('hex'));
      }
      return signatures;
    });
    await context.addInitScript((wallet) => {
      const bytes = (hex) => new Uint8Array(hex.match(/../g).map((pair) => parseInt(pair, 16)));
      const provider = {
        init: async () => true,
        isInitialized: () => true,
        isConnected: () => true,
        getType: () => 'guide',
        getAddress: async () => wallet,
        getAccount: () => ({ address: wallet }),
        setAccount: () => undefined,
        login: async () => ({ address: wallet, signature: '' }),
        logout: async () => true,
        getTokenLoginSignature: () => undefined,
        signTransactions: async (transactions) => {
          const signatures = await window.__guideSign(transactions.map((transaction) => transaction.toPlainObject()));
          transactions.forEach((transaction, at) => {
            transaction.signature = bytes(signatures[at]);
          });
          return transactions;
        },
        signTransaction: async (transaction) => (await provider.signTransactions([transaction]))[0],
        signMessage: async () => {
          throw new Error('No messages here');
        }
      };
      window.multiversx = { providers: [{ name: 'Guide wallet', type: 'guide', iconUrl: '', constructor: async () => provider }] };
    }, address);
  }
  page = await context.newPage();
  await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded', timeout: LONG });
};

// Polled with evaluate, never waitForFunction: the site's content policy forbids
// evaluating strings, which is how waitForFunction works.
const until = async (fn, arg, label, timeout = LONG) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(fn, arg)) return;
    } catch {
      // mid navigation
    }
    await page.waitForTimeout(800);
  }
  throw new Error(`gave up waiting for ${label}`);
};

// Every function passed to `until` runs in the page, so it must stand alone.
const hasText = (needle) => document.body.innerText.includes(needle);
const buttonEnabled = (name) =>
  [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === name && !b.disabled);
const quiet = () => !document.body.innerText.includes('Loading');

const session = async (account) => {
  await newPage(account);
  await until(() => Boolean(sessionStorage.getItem('sdk-dapp-store')), null, 'the store');
  await page.evaluate(
    ({ address, publicKey }) => {
      const stored = JSON.parse(sessionStorage.getItem('sdk-dapp-store'));
      stored.state.account.address = address;
      stored.state.account.publicKey = publicKey;
      stored.state.account.accounts[address] = {
        address,
        balance: '0',
        isGuarded: false,
        nonce: 0,
        txCount: 0,
        scrCount: 0,
        claimableRewards: '0'
      };
      stored.state.loginInfo.providerType = 'guide';
      sessionStorage.setItem('sdk-dapp-store', JSON.stringify(stored));
    },
    { address: account.address.toBech32(), publicKey: account.address.toHex() }
  );
  await seed(SAFES);
};

/** Photographs the window; `section` scrolls to it first. */
const shot = async (name, section) => {
  if (!wanted(Number(name.slice(0, 2)))) return;
  if (section) {
    await page.evaluate((start) => {
      const target = [...document.querySelectorAll('section, h2, h1')].find((el) =>
        el.innerText.trim().startsWith(start)
      );
      if (target) window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - 110);
    }, section);
    await page.waitForTimeout(600);
  }
  // A resting pointer opens tooltips: park it on empty page margin first.
  await page.mouse.move(8, 450);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`    saved ${OUT}${name}.png`);
};

const go = async (path) => {
  await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded', timeout: LONG });
};

const seed = (safes) =>
  page.evaluate(
    ([safes, labels]) => {
      localStorage.setItem('mvxsafe.savedSafes', JSON.stringify(safes));
      localStorage.setItem('mvxsafe.labels', JSON.stringify(labels));
      sessionStorage.removeItem('mvxsafe.cards');
    },
    [safes, LABELS]
  );

const fill = async (placeholder, value, nth = 0) =>
  page.locator(`input[placeholder="${placeholder}"]`).nth(nth).fill(value);

// Buttons by their exact name: "Propose" would also match "Add proposer".
const button = (name) => page.getByRole('button', { name, exact: true });

const openSafe = async (address, ready = 'a board member here') => {
  await go(`/safe/${address}`);
  await until(hasText, ready, 'the safe');
  await until(quiet, null, 'the reads');
  await page.waitForTimeout(1500);
};

const fillPayment = async (amount) => {
  await until(buttonEnabled, 'Propose', 'the propose form to unlock');
  await button('Send tokens').click();
  await until((token) => [...document.querySelectorAll('option')].some((o) => o.value === token), TOKEN, 'the token');
  await page.locator('select').first().selectOption(TOKEN);
  await fill('erd1...', CAROL);
  await fill('0.00', amount);
};

/** What the pictures need the safe to hold: 900 of the token and a little EGLD. */
const stockTheSafe = async () => {
  const send = async (account, data, value, gasLimit) => {
    const fresh = await api.getAccount(account.address);
    const transaction = new Transaction({
      sender: account.address,
      receiver: new Address(SAFE),
      nonce: BigInt(fresh.nonce),
      value,
      gasLimit,
      chainID: 'D',
      data: new TextEncoder().encode(data)
    });
    transaction.signature = await account.signTransaction(transaction);
    return api.sendTransaction(transaction);
  };
  const held = await (await fetch(`${API}/accounts/${SAFE}/tokens/${TOKEN}`)).json();
  if (BigInt(held.balance ?? 0) === 0n) {
    const amount = (900n * 10n ** 18n).toString(16).padStart(2, '0');
    const even = amount.length % 2 ? `0${amount}` : amount;
    say(`Sending the token to the safe: ${await send(keys.alice, `ESDTTransfer@${Buffer.from(TOKEN).toString('hex')}@${even}`, 0n, 600000n)}`);
    await wait(30000);
  }
  const { balance } = await (await fetch(`${API}/accounts/${SAFE}?fields=balance`)).json();
  if (BigInt(balance) < 300000000000000000n) {
    say(`Sending EGLD to the safe: ${await send(keys.carol, '', 300000000000000000n, 60000n)}`);
    await wait(30000);
  }
};

try {
  await stockTheSafe();

  // --- 1. Without a wallet (pictures 1 to 5) ------------------------------------

  if (phase(1, 5)) {
    say('Without a wallet.');
    await newPage();
    await seed([]);
    await go('/');
    await until(hasText, 'Add a safe', 'the list');
    await page.waitForTimeout(1500);
    await shot('01-empty');

    await fill('Name', 'Team safe');
    await fill('erd1...', SAFE);
    await page.waitForTimeout(400);
    await shot('02-add', 'Add a safe');

    await seed(SAFES);
    await go('/');
    // The card's counts are in: a number under "Proposed so far".
    await until(() => /Proposed so far\s*\d/.test(document.body.innerText), null, 'the card');
    await page.waitForTimeout(1500);
    await shot('03-list-read-only');

    await openSafe(SAFE, 'Board and proposers');
    await shot('04-safe-read-only');

    await go('/');
    await until(hasText, 'Add a safe', 'the list');
    await page.getByRole('button', { name: /^Connect/ }).first().click();
    await page.waitForTimeout(2500);
    await shot('05-connect');
    await page.context().close();
  }

  // --- 2. Connected as Alice (pictures 6 to 14, 19 and 20) ----------------------

  if (phase(6, 14) || phase(19, 20)) {
    say('Connected as Alice.');
    await session(keys.alice);
  }

  if (phase(6, 10)) {
    await go('/');
    await until(
      () => document.body.innerText.includes('board member') && /Proposed so far\s*\d/.test(document.body.innerText),
      null,
      'the badge'
    );
    await page.waitForTimeout(1500);
    await shot('06-list-board-member');

    await openSafe(SAFE);
    await shot('07-safe');
    await shot('08-board-holdings', 'Board and proposers');

    await go('/create');
    await until(hasText, 'Create', 'the create page');
    await fill('Treasury', 'Team safe');
    await fill('erd1...', ALICE, 0);
    await fill('erd1...', BOB, 1);
    await fill('erd1...', DAVE, 2);
    await page.waitForTimeout(800);
    await shot('09-create');

    // A membership change says what it does while it is typed; nothing is proposed.
    await openSafe(SAFE);
    await button('Add proposer').click();
    await fill('erd1...', ALICE);
    await page.waitForTimeout(800);
    await shot('10-membership-note', 'Propose an action');
  }

  if (phase(11, 11)) {
    // A change the contract would only refuse later is refused here at once.
    await openSafe(SAFE);
    await button('Remove member').click();
    await fill('erd1...', STRANGER);
    await button('Propose').click();
    await page.waitForTimeout(800);
    await shot('11-refused', 'Propose an action');
  }

  if (phase(19, 20)) {
    // Filled in only: nothing is proposed.
    await openSafe(SAFE);
    await button('Call a contract').click();
    await page.locator('input[placeholder="erd1qqqqqqqqqqqqqpgq..."]').first().fill(OWNED);
    await fill('setFee', 'pauseCreation');
    await page.waitForTimeout(12000);
    await shot('19-call-form', 'Propose an action');

    await openSafe(SAFE);
    await button('Upgrade a contract').click();
    const codeHash = async (address) => {
      const { codeHash: hash } = await (await fetch(`${API}/accounts/${address}?fields=codeHash`)).json();
      return Buffer.from(hash, 'base64').toString('hex');
    };
    await page.locator('input[placeholder="erd1qqqqqqqqqqqqqpgq..."]').first().fill(OWNED);
    await page.locator('input[placeholder="erd1qqqqqqqqqqqqqpgq..."]').nth(1).fill(SOURCE);
    await fill('64 hex characters from the release', await codeHash(SOURCE));
    await page.waitForTimeout(12000);
    await shot('20-upgrade-form', 'Propose an action');
  }

  // --- 3. Discard (picture 12) --------------------------------------------------

  if (phase(12, 12)) {
    say('A small payment, to be discarded.');
    await openSafe(SAFE);
    await fillPayment('1');
    await button('Propose').click();
    await until(buttonEnabled, 'Remove my signature', 'a pending action Alice signed');
    await button('Remove my signature').click();
    await until(buttonEnabled, 'Discard', 'Discard to switch on');
    await page.waitForTimeout(1500);
    await shot('12-discard-ready', 'Pending actions');
    await button('Discard').click();
    await until(() => !document.body.innerText.includes('Discard'), null, 'the discard');
    await page.waitForTimeout(8000);
  }

  // --- 4. A payment, proposed by Alice (pictures 13 and 14) ---------------------

  if (phase(13, 14)) {
    say('A payment of 10 to Carol.');
    await openSafe(SAFE);
    await fillPayment('10');
    await page.waitForTimeout(800);
    await shot('13-propose-form', 'Propose an action');
    await button('Propose').click();
    await until(
      (token) => new RegExp(`Send 10 ${token}[\\s\\S]*1 of \\d signatures`).test(document.body.innerText),
      TOKEN,
      'the proposal'
    );
    await page.waitForTimeout(2500);
    await shot('14-pending-proposer', 'Pending actions');
  }

  // --- 5. Bob signs and carries it out (pictures 15 to 18) ----------------------

  if (phase(15, 18)) {
    say('Connected as Bob.');
    await session(keys.bob);
    await go('/');
    await until(hasText, 'needs you', 'the "needs you" card');
    await page.waitForTimeout(1500);
    await shot('15-list-needs-you');

    await go(`/safe/${SAFE}`);
    await until(buttonEnabled, 'Sign', 'the Sign button');
    await page.waitForTimeout(1500);
    await shot('16-sign', 'Pending actions');
    await button('Sign').click();
    await until(buttonEnabled, 'Carry it out', 'the quorum');
    await page.waitForTimeout(2500);
    await shot('17-ready', 'Pending actions');
    await button('Carry it out').click();
    await until(
      (token) => !document.body.innerText.includes(`Send 10 ${token}`),
      TOKEN,
      'the payment to be carried out'
    );
    await page.waitForTimeout(20000);
    await go(`/safe/${SAFE}`);
    await until(hasText, 'Board and proposers', 'the safe');
    await until(quiet, null, 'the reads');
    await page.waitForTimeout(3000);
    await shot('18-history', 'History');
  }

  // --- 6. A contract on other code (picture 21) ---------------------------------

  if (wanted(21)) {
    await newPage();
    await seed([]);
    await go(`/safe/${OTHER_CODE}`);
    await until(hasText, 'does not run the multisig code', 'the warning');
    await page.waitForTimeout(3000);
    // Only the warning: the rest of the page is empty reads.
    const box = await page.getByText('does not run the multisig code').first().evaluate((el) => {
      let card = el;
      while (card.parentElement && !/rounded/.test(card.className)) card = card.parentElement;
      const { x, y, width, height } = card.getBoundingClientRect();
      return { x, y, width, height };
    });
    const margin = 24;
    await page.screenshot({
      path: `${OUT}21-other-code.png`,
      clip: {
        x: box.x - margin,
        y: box.y - margin,
        width: box.width + margin * 2,
        height: box.height + margin * 2
      }
    });
    console.log(`    saved ${OUT}21-other-code.png`);
  }

  say('All pictures taken. Turn them into JPEGs with ./scripts/capture/to-web.sh');
} finally {
  await browser.close();
}
