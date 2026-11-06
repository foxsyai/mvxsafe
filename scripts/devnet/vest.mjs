// The vestings-from-a-safe rehearsal on devnet (brief of 6 Nov 2026), with
// throwaway keys and the SAME builders, checks and gas rules the app ships
// (src/multisig/vesting.js, gas.js, legacyCalls.js). Only the signer differs:
// in the app a wallet signs, here a devnet test key does.
//
//   node scripts/devnet/vest.mjs <step>
//
//   create     the rehearsal safe (2-of-3, shard 1) creates two cancelable
//              tranche vestings on the PINNED devnet mvxvest, paying its fees
//   claim      a beneficiary claims a vested tranche
//   cancel     the safe cancels one vesting with its cancel key
//   big        the largest batch the form allows, on a zero-fee copy of
//              mvxvest v4 in shard 0: read back from the safe, then carried out
//              with the gas the app gives it
//   feechange  a batch signed at one fee and carried out after the fee
//              changed: it must fail, and the tokens come back to the safe
//   status     what the safe and the beneficiaries hold
//
// State and every hash: scripts/devnet/vest-state.json. Results:
// docs/vestings-from-a-safe.md.
import { blake2b } from '@noble/hashes/blake2b';
import { Abi, Address, SmartContractTransactionsFactory, Token, TokenTransfer, TransactionsFactoryConfig } from '@multiversx/sdk-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performPlan } from '../../src/multisig/gas.js';
import {
  buildProposeCancelVesting,
  buildProposeVestings,
  CANCEL_GAS_NEED,
  mvxvestFor,
  trancheSchedule,
  vestingGasNeed,
  vestingPayment,
  vestingProblem
} from '../../src/multisig/vesting.js';
import { big, CHAIN, getJson, load, perform, propose, query, send, sign, sleep, text } from './chain.mjs';

const STATE_FILE = 'scripts/devnet/vest-state.json';
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const TOKEN = 'TSAFED-e52b18';
const UNIT = 10n ** 18n;
const DAY = 86400;
const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const PINNED = mvxvestFor('devnet');
// The probe's zero-fee copy in shard 0 (carol owns it): a safe in another
// shard, the layout where the network cannot simulate the call as the safe.
const COPY = {
  address: 'erd1qqqqqqqqqqqqqpgq47urq5rmd2x54tp638hejcm5uyn9t6ymaujqqxf98a',
  codeHashes: [V4],
  claimKey: 'VESTKEY-2a3443',
  cancelKey: 'VESTCANCEL-2affd9'
};

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { hashes: [] };
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
const log = {
  push(entry) {
    state.hashes.push(entry);
    save();
  }
};
const vestAbi = Abi.create(JSON.parse(readFileSync('src/abi/mvxvest.abi.json', 'utf8')));
const vestFactory = new SmartContractTransactionsFactory({ config: new TransactionsFactoryConfig({ chainID: CHAIN }), abi: vestAbi });

/** What the app reads before proposing (vestingReads.ts), read the same way here. */
const readFacts = async (pin, token) => {
  const contract = await getJson(`/accounts/${pin.address}`);
  const code = typeof contract?.code === 'string' ? Buffer.from(contract.code, 'hex') : null;
  const [[paused], [claim], [cancel], [fee], [bps]] = await Promise.all(
    ['isCreationPaused', 'getClaimKeyCollection', 'getCancelKeyCollection', 'getFee', 'getTokenFee'].map((fn) => query(pin.address, fn))
  );
  const account = await getJson(`/accounts/${SAFE}`);
  const holding = token ? await getJson(`/accounts/${SAFE}/tokens/${token}`) : null;
  return {
    codeHash: code?.length ? Buffer.from(blake2b(code, { dkLen: 32 })).toString('hex') : null,
    creationPaused: paused === '01',
    claimKeyIssued: Boolean(claim),
    cancelKeyIssued: Boolean(cancel),
    claimKeyCollection: text(claim) || undefined,
    cancelKeyCollection: text(cancel) || undefined,
    fee: big(fee),
    tokenFeeBps: Number(big(bps)),
    safePayableBySc: Boolean(account.isPayableBySmartContract),
    safeBalance: holding ? BigInt(holding.balance) : 0n,
    safeEgld: BigInt(account.balance)
  };
};

const heldKeys = async (collection, address = SAFE) =>
  (await getJson(`/accounts/${address}/nfts?collections=${collection}&size=100`)) ?? [];
const tokenBalance = async (address) => BigInt((await getJson(`/accounts/${address}/tokens/${TOKEN}`))?.balance ?? '0');
const shown = (raw) => `${Number(raw) / 1e18}`;
/** A number as a view argument: hex of even length ("1bb" is read wrongly). */
const hexArg = (value) => {
  const hex = BigInt(value).toString(16);
  return hex.length % 2 ? `0${hex}` : hex;
};

/** Proposes the batch, signs it and carries it out with the gas the app would give it. */
const createOn = async (pin, label, entries, { cancelable = true, beforePerform, expectFailure = false } = {}) => {
  const [alice, bob] = ['alice', 'bob'].map(load);
  const facts = await readFacts(pin, TOKEN);
  const problem = vestingProblem({ pin, facts, safe: SAFE, token: TOKEN, cancelable, label, entries, decimals: 18 });
  if (problem) throw new Error(`refused before proposing: ${problem}`);
  const payment = vestingPayment(entries, facts);
  console.log(`       fees ${shown(facts.fee)} EGLD a vesting + ${facts.tokenFeeBps} bps: pays ${shown(payment.tokenAmount)} ${TOKEN} and ${shown(payment.egldFee)} EGLD`);
  const id = await propose(
    SAFE,
    (context) => buildProposeVestings(context, { pin, facts, token: TOKEN, cancelable, label, entries, decimals: 18 }),
    alice,
    label,
    log
  );
  await sign(SAFE, id, bob, label, log);
  if (beforePerform) await beforePerform(id);
  const need = vestingGasNeed({ entries, cancelable, feesPaid: payment.tokenFee > 0n || payment.egldFee > 0n });
  const plan = performPlan({ name: 'SendAsyncCall', callNeed: need });
  console.log(`       perform budget ${plan.gasLimit.toLocaleString('en-US')} (need ${need.toLocaleString('en-US')} plus a fifth, 7.5M safe, 7M callback)`);
  const result = await perform(SAFE, id, alice, label, plan.gasLimit, log, { expectFailure });
  return { id, result, payment, gasLimit: plan.gasLimit };
};

const steps = {
  async create() {
    if (state.created) return console.log(`already created: action #${state.created.action}`);
    const [erin, frank] = ['erin', 'frank'].map(load);
    const first = Math.floor(Date.now() / 1000) + 10 * 60;
    const entries = [
      { beneficiary: erin.address.toBech32(), schedule: trancheSchedule([{ time: first, amount: 4n * UNIT }, { time: first + 2 * DAY, amount: 6n * UNIT }]) },
      { beneficiary: frank.address.toBech32(), schedule: trancheSchedule([{ time: first, amount: 2n * UNIT }, { time: first + 3 * DAY, amount: 4n * UNIT }]) }
    ];
    const keysBefore = new Set((await heldKeys(PINNED.cancelKey)).map((nft) => nft.identifier));
    const egldBefore = BigInt((await getJson(`/accounts/${SAFE}`)).balance);
    const tokensBefore = await tokenBalance(SAFE);
    const { id, payment } = await createOn(PINNED, 'mvxsafe rehearsal', entries);
    await sleep(8000);
    const keys = (await heldKeys(PINNED.cancelKey)).filter((nft) => !keysBefore.has(nft.identifier));
    const egldAfter = BigInt((await getJson(`/accounts/${SAFE}`)).balance);
    const tokensAfter = await tokenBalance(SAFE);
    state.created = { action: id, first, keys: keys.map((nft) => ({ identifier: nft.identifier, nonce: nft.nonce })) };
    save();
    console.log(`       the safe paid ${shown(tokensBefore - tokensAfter)} ${TOKEN} (expected ${shown(payment.tokenAmount)}) and ${shown(egldBefore - egldAfter)} EGLD (expected ${shown(payment.egldFee)})`);
    console.log(`       cancel keys that arrived in the safe: ${keys.map((nft) => nft.identifier).join(', ') || 'NONE'}`);
    if (keys.length !== 2) throw new Error('expected two cancel keys in the safe');
  },

  async claim() {
    const erin = load('erin');
    const wait = state.created.first + 10 - Math.floor(Date.now() / 1000);
    if (wait > 0) {
      console.log(`       the first tranche vests in ${wait}s; waiting`);
      await sleep(wait * 1000);
    }
    const before = await tokenBalance(erin.address.toBech32());
    const mine = await heldKeys(PINNED.claimKey, erin.address.toBech32());
    // erin's key for this rehearsal's vesting: the newest.
    const key = mine.sort((a, b) => b.nonce - a.nonce)[0];
    const transaction = await vestFactory.createTransactionForExecute(erin.address, {
      contract: Address.newFromBech32(PINNED.address),
      function: 'claim',
      gasLimit: 0n,
      arguments: [],
      tokenTransfers: [new TokenTransfer({ token: new Token({ identifier: PINNED.claimKey, nonce: BigInt(key.nonce) }), amount: 1n })]
    });
    await send(transaction, erin, `erin claims with ${key.identifier}`, { log });
    await sleep(6000);
    console.log(`       erin received ${shown((await tokenBalance(erin.address.toBech32())) - before)} ${TOKEN}`);
  },

  async cancel() {
    const [alice, bob, erin] = ['alice', 'bob', 'erin'].map(load);
    const facts = await readFacts(PINNED);
    let chosen;
    for (const key of state.created.keys) {
      const [id] = await query(PINNED.address, 'getVestingByCancelNonce', [hexArg(key.nonce)]);
      const [view] = await query(PINNED.address, 'getVesting', [id]);
      if (view.includes(erin.address.toHex())) chosen = { ...key, vesting: Number(big(id)) };
    }
    console.log(`       cancelling vesting #${chosen.vesting} with ${chosen.identifier}`);
    const before = await tokenBalance(SAFE);
    const label = `cancel vesting ${chosen.vesting}`;
    const id = await propose(
      SAFE,
      (context) => buildProposeCancelVesting(context, { pin: PINNED, facts, collection: PINNED.cancelKey, nonce: chosen.nonce }),
      alice,
      label,
      log
    );
    await sign(SAFE, id, bob, label, log);
    const plan = performPlan({ name: 'SendAsyncCall', callNeed: CANCEL_GAS_NEED });
    await perform(SAFE, id, alice, label, plan.gasLimit, log);
    await sleep(8000);
    state.cancelled = { action: id, vesting: chosen.vesting, key: chosen.identifier };
    save();
    console.log(`       the safe got back ${shown((await tokenBalance(SAFE)) - before)} ${TOKEN}; it still holds ${chosen.identifier}: ${(await heldKeys(PINNED.cancelKey)).some((nft) => nft.identifier === chosen.identifier)}`);
  },

  async big() {
    const carol = load('carol');
    await zeroFees(carol);
    const people = ['erin', 'frank', 'dave', 'bob', 'carol', 'alice'].map((name) => load(name).address.toBech32());
    const first = Math.floor(Date.now() / 1000) + 30 * DAY;
    // Ten half-yearly tranches of an 8-byte amount, and as many vestings as
    // the form allows: the batch the size cap stops at.
    const entryAt = (at) => ({
      beneficiary: people[at % people.length],
      schedule: trancheSchedule(Array.from({ length: 10 }, (_, k) => ({ time: first + k * 182 * DAY, amount: 10n ** 17n + BigInt(at) })))
    });
    const facts = await readFacts(COPY, TOKEN);
    let count = 32;
    while (count > 0 && vestingProblem({ pin: COPY, facts, safe: SAFE, token: TOKEN, cancelable: true, label: 'mvxsafe largest batch', entries: Array.from({ length: count }, (_, at) => entryAt(at)) })) count--;
    const entries = Array.from({ length: count }, (_, at) => entryAt(at));
    console.log(`       the form allows ${count} cancelable vestings of 10 tranches here`);
    const keysBefore = (await heldKeys(COPY.cancelKey)).length;
    const { id } = await createOn(COPY, 'mvxsafe largest batch', entries, {
      beforePerform: async (action) => {
        // The safe can still return it, alone and in the full pending list (SC-01).
        const data = await query(SAFE, 'getActionData', [hexArg(action)]);
        const pending = await query(SAFE, 'getPendingActionFullInfo');
        console.log(`       read back: getActionData ${data[0].length / 2} bytes; getPendingActionFullInfo answered ${pending.length} item(s)`);
      }
    });
    await sleep(10000);
    const keysAfter = (await heldKeys(COPY.cancelKey)).length;
    state.big = { action: id, count, keysArrived: keysAfter - keysBefore };
    save();
    console.log(`       cancel keys that arrived: ${keysAfter - keysBefore} of ${count}`);
  },

  async feechange() {
    const carol = load('carol');
    await zeroFees(carol);
    const erin = load('erin');
    const first = Math.floor(Date.now() / 1000) + 30 * DAY;
    const entries = [{ beneficiary: erin.address.toBech32(), schedule: trancheSchedule([{ time: first, amount: UNIT }]) }];
    const before = await tokenBalance(SAFE);
    const { id } = await createOn(COPY, 'mvxsafe fee change', entries, {
      expectFailure: true,
      beforePerform: async () => {
        // The owner changes the fee after the board signed.
        await setFees(carol, 10n ** 15n, 0);
      }
    });
    await sleep(10000);
    const after = await tokenBalance(SAFE);
    const left = await query(SAFE, 'getActionData', [hexArg(id)]).catch((error) => [String(error.message)]);
    state.feechange = { action: id, safeBefore: before, safeAfter: after };
    save();
    console.log(`       the safe holds ${shown(after)} ${TOKEN}, ${shown(before)} before: ${after === before ? 'everything came back' : 'NOT the same'}`);
    console.log(`       the action now reads: ${left[0] === '' || left[0] === '00' ? 'Nothing (used up)' : left[0].slice(0, 40)}`);
    await zeroFees(carol);
  },

  /** Two actions left pending for the cards to be read in the app: a batch and a cancel. */
  async pending() {
    const [alice, erin, frank] = ['alice', 'erin', 'frank'].map(load);
    const first = Math.floor(Date.now() / 1000) + 60 * DAY;
    const entries = [
      { beneficiary: erin.address.toBech32(), schedule: trancheSchedule([{ time: first, amount: 5n * UNIT }, { time: first + 182 * DAY, amount: 5n * UNIT }]) },
      { beneficiary: frank.address.toBech32(), schedule: trancheSchedule([{ time: first, amount: 3n * UNIT }]) }
    ];
    const facts = await readFacts(PINNED, TOKEN);
    const batch = await propose(
      SAFE,
      (context) => buildProposeVestings(context, { pin: PINNED, facts, token: TOKEN, cancelable: true, label: 'card check', entries, decimals: 18 }),
      alice,
      'a batch left pending',
      log
    );
    const key = state.created.keys.find((held) => held.identifier !== state.cancelled.key);
    const cancel = await propose(
      SAFE,
      (context) => buildProposeCancelVesting(context, { pin: PINNED, facts, collection: PINNED.cancelKey, nonce: key.nonce }),
      alice,
      `a cancel of ${key.identifier} left pending`,
      log
    );
    state.pending = { batch, cancel, key: key.identifier };
    save();
    console.log(`       pending: #${batch} (batch), #${cancel} (cancel ${key.identifier})`);
  },

  async status() {
    for (const [name, address] of [['safe', SAFE], ['erin', load('erin').address.toBech32()], ['frank', load('frank').address.toBech32()]]) {
      const keys = [...(await heldKeys(PINNED.cancelKey, address)), ...(await heldKeys(PINNED.claimKey, address))];
      console.log(`${name.padEnd(6)} ${shown(await tokenBalance(address))} ${TOKEN}; keys ${keys.map((nft) => nft.identifier).join(', ') || 'none'}`);
    }
  }
};

const setFees = async (owner, egld, bps) => {
  for (const [fn, value] of [['setFee', egld], ['setTokenFee', bps]]) {
    const transaction = await vestFactory.createTransactionForExecute(owner.address, {
      contract: Address.newFromBech32(COPY.address),
      function: fn,
      gasLimit: 0n,
      arguments: [value]
    });
    await send(transaction, owner, `${fn} ${value} on the copy`, { log });
  }
};
const zeroFees = async (owner) => {
  const [[fee], [bps]] = await Promise.all([query(COPY.address, 'getFee'), query(COPY.address, 'getTokenFee')]);
  if (big(fee) !== 0n || big(bps) !== 0n) await setFees(owner, 0n, 0);
};

const step = process.argv[2];
if (!steps[step]) {
  console.error(`Steps: ${Object.keys(steps).join(', ')}`);
  process.exit(1);
}
await steps[step]();
