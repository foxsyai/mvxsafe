// The app in a real browser on devnet, driven by Playwright (audit of 21 Oct
// 2026). The wallet is a provider registered on window.multiversx, the way a
// wallet extension registers itself, and the session the app restores at
// start-up names it. Its signatures are made here in node, so the key never
// enters the page and is never printed.
//
//   node scripts/devnet/browser.mjs create   # TXN-01: sign, then create a safe at once
//   node scripts/devnet/browser.mjs watch    # sign, then watch sdk-dapp's status polls
//   node scripts/devnet/browser.mjs stuck    # the stuck toast: no websocket, every status poll refused
//   node scripts/devnet/browser.mjs load     # signed in, with /websocket/config refused: the page still opens
//
// In stuck mode POLLS says how sdk-dapp's status polls are answered: 429 (the
// default: every one refused, which kept its toast spinning) or missing (an
// empty list, which made it call a successful transaction timed out). The run
// passes when the session still ends as the network has the transaction. SHOT
// names a file for a picture of the page at the end.
//
// TARGET is the site (https://devnet.mvxsafe.io by default, or a local
// `vite preview` of a devnet build), SAFE a devnet safe where alice is on the
// board, CHROMIUM a browser to use instead of Playwright's own.
import { Account, Transaction } from '@multiversx/sdk-core';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const MODE = process.argv[2] ?? 'create';
const TARGET = (process.env.TARGET ?? 'https://devnet.mvxsafe.io').replace(/\/$/, '');
const SAFE = process.env.SAFE ?? readFileSync('scripts/devnet/safe.txt', 'utf8').trim();
const API = 'https://devnet-api.multiversx.com';
const GATEWAY = 'https://devnet-gateway.multiversx.com';
const DEPLOY_RECEIVER_END = '6gq4hu';
// Generous: the connection to the site has been as slow as 23 KB/s.
const LONG = 300000;

const alice = Account.newFromMnemonic(
  readFileSync(`${homedir()}/.mvxsafe-devnet/alice.mnemonic`, 'utf8').trim()
);
const ADDRESS = alice.address.toBech32();
const started = Date.now();
const log = (...args) =>
  console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s`, ...args);
const apiGet = async (path) => (await fetch(`${API}${path}`)).json();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
);
// Certificate errors only for a local preview, which has a self-signed one:
// for the real site, a TLS-intercepting proxy must not pass for it.
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(TARGET);
const context = await browser.newContext({ ignoreHTTPSErrors: isLocal });
const signed = [];
// Every frame in the context can call this, so it signs only what this
// rehearsal sends: devnet, from alice (review of PR #13).
await context.exposeFunction('__rehearsalSign', async (plains) => {
  const signatures = [];
  for (const plain of plains) {
    if (plain?.chainID !== 'D' || plain?.sender !== ADDRESS) {
      throw new Error(`refused: chain ${plain?.chainID}, sender ${plain?.sender}`);
    }
    const transaction = Transaction.newFromPlainObject(plain);
    signatures.push(Buffer.from(await alice.signTransaction(transaction)).toString('hex'));
    const fn = Buffer.from(transaction.data).toString().split('@')[0].slice(0, 28);
    signed.push({ nonce: Number(transaction.nonce), receiver: transaction.receiver.toBech32(), fn });
    log(`wallet signs nonce ${transaction.nonce} -> ${transaction.receiver.toBech32().slice(-8)} ${fn}`);
  }
  return signatures;
});
await context.addInitScript(({ address }) => {
  const bytes = (hex) => new Uint8Array(hex.match(/../g).map((pair) => parseInt(pair, 16)));
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
    signTransaction: async (transaction) => (await provider.signTransactions([transaction]))[0],
    signMessage: async () => {
      throw new Error('No messages in this rehearsal');
    }
  };
  window.multiversx = {
    providers: [{ name: 'Rehearsal wallet', type: 'rehearsal', iconUrl: '', constructor: async () => provider }]
  };
}, { address: ADDRESS });

const POLLS = process.env.POLLS ?? '429';
const refusal = {
  status: 429,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' },
  body: '{"statusCode":429,"message":"Too Many Requests"}'
};
if (MODE === 'load') {
  await context.route(/\/websocket\/config/, (route) => route.fulfill(refusal));
}
if (MODE === 'stuck') {
  // sdk-dapp's websocket is closed as soon as it opens, so it polls at its
  // fastest; and it is never answered the way it needs.
  await context.routeWebSocket(/socket-api\.multiversx\.com/, (socket) => socket.close());
  await context.route(/\/transactions\?.*hashes=/, (route) =>
    route.fulfill(POLLS === 'missing' ? { ...refusal, status: 200, body: '[]' } : refusal)
  );
}

const page = await context.newPage();
page.on('pageerror', (error) => log('page error:', String(error).slice(0, 160)));

// A session for the rehearsal wallet, which the app restores at start-up.
await page.goto(`${TARGET}/`, { waitUntil: 'domcontentloaded', timeout: LONG });
await page.waitForFunction(() => Boolean(sessionStorage.getItem('sdk-dapp-store')), null, { timeout: LONG });
await page.evaluate(({ address, publicKey }) => {
  const stored = JSON.parse(sessionStorage.getItem('sdk-dapp-store'));
  stored.state.account.address = address;
  stored.state.account.publicKey = publicKey;
  stored.state.account.accounts[address] = {
    address, balance: '0', isGuarded: false, nonce: 0, txCount: 0, scrCount: 0, claimableRewards: '0'
  };
  stored.state.loginInfo.providerType = 'rehearsal';
  sessionStorage.setItem('sdk-dapp-store', JSON.stringify(stored));
}, { address: ADDRESS, publicKey: alice.address.toHex() });

const polls = [];
page.on('response', (response) => {
  if (/\/transactions\?.*hashes=/.test(response.url())) polls.push({ at: Date.now(), status: response.status() });
});
page.on('requestfailed', (request) => {
  if (/hashes=/.test(request.url())) polls.push({ at: Date.now(), status: 'failed' });
});

await page.goto(`${TARGET}/safe/${SAFE}`, { waitUntil: 'domcontentloaded', timeout: LONG });
if (MODE === 'load') {
  // A blank page never shows it: initApp threw, and nothing rendered.
  const opened = await page
    .getByText(/a board member here/)
    .waitFor({ timeout: 60000 })
    .then(() => true, () => false);
  const websocket = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('sdk-dapp-store') || '{}').state?.config?.websocketStatus
  );
  log(opened
    ? `OK: with /websocket/config refused, the safe page opened for alice (websocket ${websocket})`
    : `NOT OK: with /websocket/config refused, the page stayed blank (websocket ${websocket})`);
  await browser.close();
  process.exit(opened ? 0 : 1);
}
await page.getByText(/a board member here/).waitFor({ timeout: LONG });
log('connected as alice, a board member of', SAFE.slice(-8));

/** Sign the first action alice can sign, or remove her signature from one. */
const signSomething = async () => {
  const sign = page.getByRole('button', { name: 'Sign', exact: true }).first();
  const unsign = page.getByRole('button', { name: 'Remove my signature' }).first();
  await Promise.race([sign.waitFor({ timeout: LONG }), unsign.waitFor({ timeout: LONG })]);
  const first = (await sign.count()) ? sign : unsign;
  const label = (await first.textContent()).trim();
  await page.waitForFunction(
    (text) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === text && !b.disabled),
    label,
    { timeout: LONG }
  );
  await first.click();
  await page.getByText(/^Sent\./).waitFor({ timeout: LONG });
  return label;
};

const storeNow = () =>
  page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem('sdk-dapp-store') || '{}').state || {};
    const sessions = Object.values(state.transactions || {});
    const last = sessions[sessions.length - 1];
    return {
      websocket: state.config?.websocketStatus,
      session: last?.status,
      transactions: (last?.transactions || []).map((transaction) => transaction.status),
      hashes: (last?.transactions || []).map((transaction) => transaction.hash)
    };
  });

let ok = true;
if (MODE === 'watch') {
  const sentAt = Date.now();
  log(`${await signSomething()} sent`);
  for (let i = 0; i < 12; i++) {
    await wait(5000);
    const store = await storeNow();
    const statuses = [...new Set(polls.map((poll) => poll.status))].join(',');
    log(`+${Math.round((Date.now() - sentAt) / 1000)}s: ${polls.length} polls (${statuses}) | websocket ${store.websocket} | session ${store.session} [${store.transactions.join(',')}]`);
  }
  const gaps = polls.slice(1).map((poll, at) => ((poll.at - polls[at].at) / 1000).toFixed(1));
  log('seconds between polls:', gaps.slice(0, 24).join(' '));
} else if (MODE === 'stuck') {
  const sentAt = Date.now();
  log(`${await signSomething()} sent; status polls answered: ${POLLS}`);
  let store = await storeNow();
  const seen = [];
  for (let i = 0; i < 24; i++) {
    await wait(5000);
    store = await storeNow();
    const since = Math.round((Date.now() - sentAt) / 1000);
    if (seen[seen.length - 1]?.session !== store.session) seen.push({ since, session: store.session });
    log(`+${since}s: ${polls.length} polls answered ${POLLS} | websocket ${store.websocket} | session ${store.session} [${store.transactions.join(',')}]`);
    if (['success', 'fail', 'invalid'].includes(store.session) && i >= 7) break;
  }
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // The nodes' answer: the API's index has lagged minutes behind them.
  const chain = await Promise.all(
    store.hashes.map(async (hash) => {
      const answer = await (await fetch(`${GATEWAY}/transaction/${hash}/process-status`)).json();
      return { hash, status: answer?.data?.status ?? 'not found' };
    })
  );
  log('the nodes say:', chain.map(({ hash, status }) => `${hash} ${status}`).join(', '));
  log('the session went', seen.map(({ since, session }) => `${session} (+${since}s)`).join(' -> '));
  const statuses = chain.map(({ status }) => status);
  const truth = statuses.every((status) => status === 'success')
    ? 'success'
    : statuses.some((status) => status === 'fail' || status === 'invalid')
      ? 'fail'
      : 'pending';
  ok = truth !== 'pending' && store.session === truth;
  log(ok
    ? `OK: the toast ended as ${truth}, as the network has it, with every status poll ${POLLS === 'missing' ? 'missing the hash' : 'refused'}`
    : `NOT OK: the toast is "${store.session}" where the network has ${truth}`);
} else {
  const chainBefore = (await apiGet(`/accounts/${ADDRESS}`)).nonce;
  const label = await signSomething();
  log(`first transaction (${label}) sent; the API said nonce ${chainBefore} before it`);

  // Straight to Create, as a person would, without reloading the page.
  await page.evaluate(() => {
    history.pushState({}, '', '/create');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  const create = page.getByRole('button', { name: 'Create a 1 of 1 safe' });
  await create.waitFor({ timeout: LONG });
  await page.getByPlaceholder('Treasury').fill('Rehearsal TXN-01');
  const chainAtCreate = (await apiGet(`/accounts/${ADDRESS}`)).nonce;
  await create.click();
  log(`Create pressed; the API says nonce ${chainAtCreate}`);
  await page.waitForURL(/\/safe\/erd1/, { timeout: LONG });
  const shown = page.url().split('/safe/')[1];
  log('the app opened', shown);

  const deploy = signed.find((entry) => entry.receiver.endsWith(DEPLOY_RECEIVER_END));
  log(deploy && deploy.nonce > chainAtCreate
    ? 'the first transaction was still pending when Create was pressed: the TXN-01 window'
    : 'the first transaction had already landed: an ordinary create');

  let account = {};
  for (let i = 0; i < 40; i++) {
    await wait(4000);
    account = await apiGet(`/accounts/${shown}`);
    if (account.codeHash && account.ownerAddress === shown) break;
  }
  const transactions = await apiGet(`/accounts/${ADDRESS}/transactions?size=4&fields=txHash,nonce,status,function`);
  for (const transaction of transactions.reverse()) {
    log(`tx ${transaction.txHash} nonce ${transaction.nonce} ${transaction.function ?? ''} ${transaction.status}`);
  }
  ok = Boolean(account.codeHash) && account.ownerAddress === shown;
  log(ok
    ? `OK: the safe the app opened has code and owns itself (${shown})`
    : `NOT OK: ${shown} has code ${Boolean(account.codeHash)}, owner ${account.ownerAddress}`);
}
await browser.close();
process.exit(ok ? 0 : 1);
