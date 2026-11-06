// The vesting forms and cards in the real app, end to end, on devnet: two
// board members of the rehearsal safe use devnet.mvxsafe.io in a browser as a
// person would. Each wallet is a provider registered on window.multiversx, the
// way a wallet extension registers itself; its signatures are made here in
// node, for devnet and that wallet only, so a key never enters the page.
//
//   node scripts/devnet/vest-ui.mjs [cleanup] [create] [cancel]
//
//   cleanup  takes back the signature on actions left pending (#37, #38) and
//            discards them, through their cards
//   create   alice fills in Create vestings (a schedule for one person and a
//            pasted row), proposes; bob reads the card and signs; alice
//            carries it out; the keys show in the holdings
//   form     what create does in the form, checked, then nothing proposed
//   cancel   alice picks one of those keys under Cancel a vesting, proposes;
//            bob reads the card and signs; alice carries it out; the unvested
//            tokens come back
//
// TARGET is the site (https://devnet.mvxsafe.io by default), OUT a folder for
// screenshots, CHROMIUM a browser to use instead of Playwright's own. Every
// result is read back from the chain, not only from the page.
import { Transaction } from '@multiversx/sdk-core';
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { big, getJson, load, query, sleep } from './chain.mjs';

const TARGET = (process.env.TARGET ?? 'https://devnet.mvxsafe.io').replace(
  /\/$/,
  ''
);
const OUT = process.env.OUT ?? 'vest-ui';
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const TOKEN = 'TSAFED-e52b18';
const CANCEL_KEY = 'VESTCANCEL-bd731d';
const LONG = 300000;
const steps = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['cleanup', 'create', 'cancel'];
mkdirSync(OUT, { recursive: true });

const started = Date.now();
const log = (...args) =>
  console.log(
    `${((Date.now() - started) / 1000).toFixed(0).padStart(5)}s`,
    ...args
  );
let failed = false;
const check = (ok, text) => {
  log(`${ok ? '  ok  ' : ' FAIL '} ${text}`);
  if (!ok) failed = true;
};
const hexArg = (value) => {
  const hex = BigInt(value).toString(16);
  return hex.length % 2 ? `0${hex}` : hex;
};
const actionGone = async (id) => {
  const [data] = await query(SAFE, 'getActionData', [hexArg(id)]);
  return !data || data === '00';
};
const signers = async (id) =>
  Number(big((await query(SAFE, 'getActionSignerCount', [hexArg(id)]))[0]));
const lastAction = async () =>
  Number(big((await query(SAFE, 'getActionLastIndex'))[0]));
const tokenOf = async (address) =>
  BigInt(
    (await getJson(`/accounts/${address}/tokens/${TOKEN}`))?.balance ?? '0'
  );
const egldOf = async (address) =>
  BigInt((await getJson(`/accounts/${address}`)).balance);
const keysOf = async () =>
  (
    (await getJson(
      `/accounts/${SAFE}/nfts?collections=${CANCEL_KEY}&size=100`
    )) ?? []
  ).map((nft) => nft.identifier);
const until = async (what, test, ms = LONG) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await sleep(4000);
  }
  throw new Error(`timed out waiting for ${what}`);
};
const units = (raw) => `${Number(raw) / 1e18}`;

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
);

/** A page of the safe, connected as one of the devnet test wallets. */
const openAs = async (name) => {
  const account = load(name);
  const address = account.address.toBech32();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 }
  });
  await context.exposeFunction('__rehearsalSign', async (plains) => {
    const signatures = [];
    for (const plain of plains) {
      // Only what this run sends: devnet, from this wallet.
      if (plain?.chainID !== 'D' || plain?.sender !== address)
        throw new Error(
          `refused: chain ${plain?.chainID}, sender ${plain?.sender}`
        );
      const transaction = Transaction.newFromPlainObject(plain);
      signatures.push(
        Buffer.from(await account.signTransaction(transaction)).toString('hex')
      );
      log(
        `${name}'s wallet signs ${Buffer.from(transaction.data).toString().split('@')[0]} (nonce ${transaction.nonce})`
      );
    }
    return signatures;
  });
  await context.addInitScript(
    ({ address }) => {
      const bytes = (hex) =>
        new Uint8Array(hex.match(/../g).map((pair) => parseInt(pair, 16)));
      const provider = {
        init: async () => true,
        isInitialized: () => true,
        isConnected: () => true,
        getType: () => 'rehearsal',
        getAddress: async () => address,
        getAccount: () => ({ address }),
        setAccount: () => undefined,
        login: async () => ({ address, signature: '' }),
        logout: async () => true,
        getTokenLoginSignature: () => undefined,
        signTransactions: async (transactions) => {
          const signatures = await window.__rehearsalSign(
            transactions.map((transaction) => transaction.toPlainObject())
          );
          transactions.forEach((transaction, at) => {
            transaction.signature = bytes(signatures[at]);
          });
          return transactions;
        },
        signTransaction: async (transaction) =>
          (await provider.signTransactions([transaction]))[0],
        signMessage: async () => {
          throw new Error('No messages in this run');
        }
      };
      window.multiversx = {
        providers: [
          {
            name: 'Rehearsal wallet',
            type: 'rehearsal',
            iconUrl: '',
            constructor: async () => provider
          }
        ]
      };
    },
    { address }
  );
  const page = await context.newPage();
  page.on('pageerror', (error) =>
    log(`${name}: page error:`, String(error).slice(0, 160))
  );
  await page.goto(`${TARGET}/`, {
    waitUntil: 'domcontentloaded',
    timeout: LONG
  });
  await page.waitForFunction(
    () => Boolean(sessionStorage.getItem('sdk-dapp-store')),
    null,
    { timeout: LONG }
  );
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
      stored.state.loginInfo.providerType = 'rehearsal';
      sessionStorage.setItem('sdk-dapp-store', JSON.stringify(stored));
    },
    { address, publicKey: account.address.toHex() }
  );
  const reload = async () => {
    await page.goto(`${TARGET}/safe/${SAFE}`, {
      waitUntil: 'domcontentloaded',
      timeout: LONG
    });
    await page.getByText(/a board member here/).waitFor({ timeout: LONG });
  };
  await reload();
  log(`${name} is connected, a board member of ${SAFE.slice(-8)}`);
  return { page, reload, name };
};

/** The card of action #id, once its checks have arrived. */
const cardOf = async (page, id) => {
  const header = page.locator(`div:has(> p > span:text-is("#${id}"))`).first();
  await header.waitFor({ timeout: LONG });
  await page.waitForFunction(
    (n) => {
      const row = [...document.querySelectorAll('p > span')].find(
        (span) => span.textContent === `#${n}`
      );
      const card = row?.closest('div')?.parentElement;
      return (
        card && !card.textContent.includes('Checking this action on chain')
      );
    },
    id,
    { timeout: LONG }
  );
  return header.locator('..');
};
const press = async (page, card, name) => {
  const button = card.getByRole('button', { name, exact: true });
  await button.waitFor({ timeout: LONG });
  await page.waitForFunction(
    (el) => !el.disabled,
    await button.elementHandle(),
    { timeout: LONG }
  );
  await button.click();
  await page.getByText(/^Sent\./).waitFor({ timeout: LONG });
};
const redLines = async (card) =>
  card.locator('[data-tone="bad"]').allTextContents();

const run = async () => {
  const alice = await openAs('alice');
  const bob = await openAs('bob');

  if (steps.includes('cleanup')) {
    for (const id of [37, 38]) {
      if (await actionGone(id)) {
        log(`#${id} is already gone`);
        continue;
      }
      await alice.reload();
      let card = await cardOf(alice.page, id);
      if ((await signers(id)) > 0) {
        await press(alice.page, card, 'Remove my signature');
        await until(
          `#${id} to have no signature`,
          async () => (await signers(id)) === 0
        );
        await alice.reload();
        card = await cardOf(alice.page, id);
      }
      await press(alice.page, card, 'Discard');
      await until(`#${id} to be discarded`, () => actionGone(id));
      check(
        await actionGone(id),
        `#${id}: signature taken back and discarded through its card`
      );
    }
  }

  let created = null;
  if (steps.includes('create') || steps.includes('form')) {
    const erin = load('erin').address.toBech32();
    const frank = load('frank').address.toBech32();
    const first = new Date(Date.now() + 30 * 86400 * 1000)
      .toISOString()
      .slice(0, 10);
    const keysBefore = await keysOf();
    const tokensBefore = await tokenOf(SAFE);
    const egldBefore = await egldOf(SAFE);
    const lastBefore = await lastAction();

    const { page } = alice;
    await page
      .getByRole('button', { name: 'Create vestings', exact: true })
      .click();
    await page.locator('#vest-token').waitFor({ timeout: LONG });
    await page.locator('#vest-token').selectOption(TOKEN);
    await page.locator('#vest-label').fill('ui test');
    await page.getByText('Add a schedule for one person').click();
    await page.getByLabel('Beneficiary', { exact: true }).fill(erin);
    await page.getByLabel('Total', { exact: true }).fill('6');
    await page.getByLabel('First tranche', { exact: true }).fill(first);
    await page.getByLabel('Tranches', { exact: true }).fill('3');
    await page.getByLabel('Every how many months', { exact: true }).fill('6');
    await page
      .getByRole('button', { name: 'Add these tranches to the rows' })
      .click();
    const rows = page.locator('#vest-rows');
    await rows.fill(`${await rows.inputValue()}\n${frank}; ${first}; 2.5`);
    await page.getByText('2 vestings, 4 tranches').waitFor({ timeout: LONG });
    // The form reads mvxvest and the safe first; its fee line and preview follow.
    await page
      .getByText(/mvxvest charges|fees read zero now/)
      .waitFor({ timeout: LONG });
    await page.getByText('The signers will see:').waitFor({ timeout: LONG });
    const form = await page
      .locator('#vest-rows')
      .locator('xpath=ancestor::div[contains(@class,"mt-4")][1]')
      .innerText();
    check(
      /mvxvest charges 0\.1 EGLD a vesting and 0\.1% of each/.test(form),
      "the form names mvxvest's fees"
    );
    check(
      form.includes(erin) && form.includes(frank),
      'the form shows both people the signers will see'
    );
    const formRed = await page
      .locator('#vest-rows')
      .locator('xpath=ancestor::div[contains(@class,"mt-4")][1]')
      .locator('[data-tone="bad"]')
      .allTextContents();
    check(
      formRed.length === 0,
      `the form shows no red line${formRed.length ? `: ${formRed.join(' | ')}` : ''}`
    );
    await page.screenshot({
      path: `${OUT}/1-create-form.png`,
      fullPage: false
    });
    if (!steps.includes('create')) return;
    const propose = page.getByRole('button', { name: 'Propose', exact: true });
    await page.waitForFunction(
      (el) => !el.disabled,
      await propose.elementHandle(),
      { timeout: LONG }
    );
    await propose.click();
    await until('the proposal', async () => (await lastAction()) > lastBefore);
    const id = await lastAction();
    log(`alice proposed #${id} through Create vestings`);

    await bob.reload();
    let card = await cardOf(bob.page, id);
    const text = await card.innerText();
    check(
      text.includes(
        `Create 2 cancelable vestings of 8.5 ${TOKEN} in all on mvxvest`
      ) && text.includes('labelled "ui test"'),
      'bob reads: Create 2 cancelable vestings of 8.5 TSAFED, labelled "ui test"'
    );
    check(
      text.includes('0.2 EGLD of fee') &&
        text.includes('pays exactly what mvxvest wants now'),
      "bob reads the fees and that they match mvxvest's now"
    );
    check(
      text.includes(erin) && text.includes(frank) && /:\s*2\b/.test(text),
      'bob sees each person with dates and amounts'
    );
    check(
      (await redLines(card)).length === 0,
      `bob's card has no red line${(await redLines(card)).length ? `: ${(await redLines(card)).join(' | ')}` : ''}`
    );
    await card.screenshot({ path: `${OUT}/2-create-card.png` });
    await press(bob.page, card, 'Sign');
    await until(
      `#${id} to have two signatures`,
      async () => (await signers(id)) >= 2
    );
    log(`bob signed #${id}`);

    await alice.reload();
    card = await cardOf(alice.page, id);
    const gas = await card
      .locator('input[aria-label^="Gas for action"]')
      .inputValue();
    log(
      `alice carries out #${id} with the card's gas, ${Number(gas).toLocaleString('en-US')}`
    );
    await press(alice.page, card, 'Carry it out');
    await until(`#${id} to be carried out`, () => actionGone(id));
    await until(
      'the keys to reach the safe',
      async () => (await keysOf()).length >= keysBefore.length + 2
    );
    await sleep(8000);
    const newKeys = (await keysOf()).filter((key) => !keysBefore.includes(key));
    const paidToken = tokensBefore - (await tokenOf(SAFE));
    const paidEgld = egldBefore - (await egldOf(SAFE));
    check(
      newKeys.length === 2,
      `the two cancel keys reached the safe: ${newKeys.join(', ')}`
    );
    check(
      paidToken === 8_508_500_000_000_000_000n,
      `the safe paid ${units(paidToken)} ${TOKEN} (8.5 and the 0.1% token fee)`
    );
    check(
      paidEgld === 200_000_000_000_000_000n,
      `the safe paid ${units(paidEgld)} EGLD of fee`
    );

    await alice.reload();
    await alice.page
      .getByText(/mvxvest cancel keys:/)
      .waitFor({ timeout: LONG });
    const holdings = await alice.page
      .getByText(/mvxvest cancel keys:/)
      .locator('xpath=ancestor::li[1]')
      .innerText();
    check(
      newKeys.every((key) => holdings.includes(key)) &&
        holdings.includes('"ui test"'),
      'the holdings list both keys with their vestings'
    );
    await alice.page
      .getByText(/mvxvest cancel keys:/)
      .locator('xpath=ancestor::section[1]')
      .screenshot({ path: `${OUT}/3-holdings.png` });
    created = { id, keys: newKeys, erin };
  }

  if (steps.includes('cancel')) {
    const { page } = alice;
    await alice.reload();
    await page
      .getByRole('button', { name: 'Cancel a vesting', exact: true })
      .click();
    await page
      .getByText(/stops vesting #/)
      .first()
      .waitFor({ timeout: LONG });
    // Erin's key from the batch above, or the newest key erin's vesting has.
    const choice = page
      .locator('label', {
        hasText: created ? new RegExp(created.keys.join('|')) : /"ui test"/
      })
      .filter({ hasText: load('erin').address.toBech32() })
      .first();
    const line = await choice.innerText();
    const key = line.match(new RegExp(`${CANCEL_KEY}-[0-9a-f]+`))[0];
    check(
      /Cancelled now, 0 TSAFED-e52b18 stays theirs to claim and 6 TSAFED-e52b18 comes back to this safe/.test(
        line
      ),
      `the cancel form says what cancelling ${key} does now`
    );
    await choice.locator('input[type="radio"]').check();
    await page.screenshot({ path: `${OUT}/4-cancel-form.png` });
    const tokensBefore = await tokenOf(SAFE);
    const lastBefore = await lastAction();
    const propose = page.getByRole('button', { name: 'Propose', exact: true });
    await page.waitForFunction(
      (el) => !el.disabled,
      await propose.elementHandle(),
      { timeout: LONG }
    );
    await propose.click();
    await until(
      'the cancel proposal',
      async () => (await lastAction()) > lastBefore
    );
    const id = await lastAction();
    log(`alice proposed #${id} through Cancel a vesting`);

    await bob.reload();
    let card = await cardOf(bob.page, id);
    const text = await card.innerText();
    check(
      text.includes(`Cancel the mvxvest vesting of the cancel key ${key}`),
      `bob reads: Cancel the mvxvest vesting of the cancel key ${key}`
    );
    check(
      /6 TSAFED-e52b18 not yet vested comes back to this safe/.test(text),
      'bob reads that 6 TSAFED comes back to the safe'
    );
    check(
      (await redLines(card)).length === 0,
      `bob's card has no red line${(await redLines(card)).length ? `: ${(await redLines(card)).join(' | ')}` : ''}`
    );
    await card.screenshot({ path: `${OUT}/5-cancel-card.png` });
    await press(bob.page, card, 'Sign');
    await until(
      `#${id} to have two signatures`,
      async () => (await signers(id)) >= 2
    );

    await alice.reload();
    card = await cardOf(alice.page, id);
    await press(alice.page, card, 'Carry it out');
    await until(`#${id} to be carried out`, () => actionGone(id));
    await until('the refund', async () => (await tokenOf(SAFE)) > tokensBefore);
    await sleep(6000);
    const back = (await tokenOf(SAFE)) - tokensBefore;
    check(
      back === 6_000_000_000_000_000_000n,
      `the safe got back ${units(back)} ${TOKEN}`
    );
    check(!(await keysOf()).includes(key), `${key} is burned`);
  }
};

try {
  await run();
} catch (error) {
  failed = true;
  log('stopped:', String(error?.message ?? error).slice(0, 300));
}
await browser.close();
log(
  failed
    ? 'FAILED'
    : 'OK: every step went through the app as a person would, and the chain agrees'
);
process.exit(failed ? 1 : 0);
