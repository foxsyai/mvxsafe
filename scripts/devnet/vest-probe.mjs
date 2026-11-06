// The first question for vestings from a safe, asked on devnet with throwaway
// keys: can a legacy multisig create mvxvest vestings as the caller, receive the
// cancel keys mvxvest sends back to its caller, and later send one of those
// keys with cancel() to get the unvested tokens back?
//
//   MVXVEST_WASM=<mvxvest release .wasm> node scripts/devnet/vest-probe.mjs <step>
//
//   deploy   a copy of mvxvest version 4 (code hash checked) in shard 0, not
//            payable, deployed by carol; its fees stay at zero
//   keys     carol issues its two key collections (0.05 EGLD each)
//   create   the rehearsal safe (2-of-3, shard 1) proposes, signs and carries
//            out createBatch: two cancelable Tranches vestings of TSAFED
//   status   what the safe, the beneficiaries and the copy hold
//   claim    a beneficiary claims its first tranche once it has vested
//   cancel   the safe sends the cancel key of that vesting with cancel()
//   fees <egld units> <bps>   carol sets the copy's fees
//   createfee  the safe pays a vesting and both fees in one transfer
//
// The layout copies mainnet: the safe in shard 1, mvxvest in shard 0, so every
// perform is a cross-shard call. State and every hash: vest-probe-state.json.
// Keys live in ~/.mvxsafe-devnet, devnet only, no value, never in git.
import {
  Abi,
  Account,
  Address,
  AddressValue,
  ApiNetworkProvider,
  BigUIntValue,
  BytesValue,
  SmartContractTransactionsFactory,
  Token,
  TokenTransfer,
  TransactionsFactoryConfig,
  VariadicValue
} from '@multiversx/sdk-core';
import { blake2b } from '@noble/hashes/blake2b';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { measureCall, performPlan, settleGas } from '../../src/multisig/gas.js';
import { buildPerform, buildSign, legacyAbi, shardOf } from '../../src/multisig/legacyCalls.js';

const KEYS = `${homedir()}/.mvxsafe-devnet`;
// LAYOUT=same runs a second copy, deployed by frank in the safe's own shard 1:
// there a refusal reverts the whole call, and the network can simulate it as
// the safe, as the app does. A mainnet safe can sit in mvxvest's shard 0.
const SAME_SHARD = process.env.LAYOUT === 'same';
const OWNER = SAME_SHARD ? 'frank' : 'carol';
const STATE_FILE = SAME_SHARD ? 'scripts/devnet/vest-probe-same-shard-state.json' : 'scripts/devnet/vest-probe-state.json';
const API = 'https://devnet-api.multiversx.com';
const CHAIN = 'D';
// mvxvest version 4, the code on mainnet and on the devnet contract the app
// will pin. The copy must run exactly this.
const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
// The upgrade rehearsal's safe: 2-of-3 (alice, bob, dave), shard 1, holds TSAFED.
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const TOKEN = 'TSAFED-e52b18';
const UNIT = 10n ** 18n;
const ISSUE_COST = UNIT / 20n;
const SYSTEM_CALL_GAS = 75_000_000n;
const VEST_ABI = Abi.create(
  JSON.parse(readFileSync('src/abi/mvxvest.abi.json', 'utf8'))
);

const api = new ApiNetworkProvider(API, { clientName: 'mvxsafe-devnet-test' });
const config = new TransactionsFactoryConfig({ chainID: CHAIN });
const vestFactory = new SmartContractTransactionsFactory({ config, abi: VEST_ABI });
const safeFactory = new SmartContractTransactionsFactory({ config, abi: legacyAbi });

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { hashes: [] };
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
const load = (name) => Account.newFromMnemonic(readFileSync(`${KEYS}/${name}.mnemonic`, 'utf8').trim());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getJson = async (path) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${API}${path}`);
    if (response.ok) return response.json();
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`${path} kept failing`);
};

/** Nonce, gas (simulated, or the budget), signature, then waits for every result. */
const send = async (transaction, signer, label, { budget } = {}) => {
  const sender = signer.address.toBech32();
  const account = await getJson(`/accounts/${sender}?withGuardianInfo=true`);
  if (account.isGuarded) throw new Error(`${sender} is guarded; this probe does not co-sign`);
  transaction.nonce = BigInt(account.nonce);
  if (transaction.gasLimit === 0n || budget) await settleGas(transaction, { provider: api, guardian: '', budget });
  transaction.signature = await signer.signTransaction(transaction);
  const hash = await api.sendTransaction(transaction);
  let onNetwork;
  for (let at = 0; at < 160; at++) {
    await sleep(2500);
    try {
      const raw = await getJson(`/transactions/${hash}?withScResults=true&withLogs=true`);
      if (raw.status === 'pending' || raw.pendingResults) continue;
      onNetwork = raw;
      break;
    } catch {
      // not indexed yet
    }
  }
  const events = (onNetwork?.logs?.events ?? []).map((event) => event.identifier);
  for (const result of onNetwork?.results ?? []) {
    for (const event of result.logs?.events ?? []) events.push(event.identifier);
  }
  const ok = onNetwork?.status === 'success' && !events.some((name) => /signalError|internalVMErrors/.test(name));
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}  ${hash}  gas ${Number(transaction.gasLimit).toLocaleString('en-US')}`);
  state.hashes.push({ label, hash, gasLimit: transaction.gasLimit.toString(), ok });
  save();
  if (!ok) throw new Error(`${label} did not succeed (${onNetwork?.status ?? 'no answer'}; events: ${events.join(', ')}): ${hash}`);
  return onNetwork;
};

const query = async (contract, fn, args = []) => {
  const response = await fetch(`${API}/vm-values/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scAddress: contract, funcName: fn, args })
  }).then((r) => r.json());
  const data = response?.data?.data ?? response?.data;
  if (data?.returnCode && data.returnCode !== 'ok') throw new Error(`${fn}: ${data.returnMessage}`);
  return (data?.returnData ?? []).map((item) => Buffer.from(item ?? '', 'base64').toString('hex'));
};
const text = (hex) => Buffer.from(hex, 'hex').toString();

/** The action id a propose created, from the contract's answer "@6f6b@<id>". */
const actionIdFrom = (onNetwork) => {
  const answers = [
    ...(onNetwork.results ?? []).map((result) => result.data),
    ...(onNetwork.logs?.events ?? []).filter((event) => event.identifier === 'writeLog').map((event) => event.data)
  ];
  for (const data of answers) {
    const parts = (data ? Buffer.from(data, 'base64').toString() : '').split('@').filter(Boolean);
    if (parts[0] === '6f6b' && parts[1]) return parseInt(parts[1], 16);
  }
  throw new Error(`no action id in ${onNetwork.txHash}`);
};

const nonceOf = async (account) => Number((await api.getAccount(account.address)).nonce);

/**
 * proposeAsyncCall with the call given as its parts: the function name and
 * each argument, already encoded. This is how the safe's own "Send tokens"
 * puts ESDTTransfer in, and how the new action will put createBatch after it.
 */
const proposeAsync = async (proposer, to, parts) => {
  const transaction = await safeFactory.createTransactionForExecute(proposer.address, {
    contract: Address.newFromBech32(SAFE),
    function: 'proposeAsyncCall',
    gasLimit: 0n,
    arguments: [
      new AddressValue(Address.newFromBech32(to)),
      new BigUIntValue(0n),
      VariadicValue.fromItems(...parts.map((part, at) => (at === 0 ? BytesValue.fromUTF8(part) : new BytesValue(Buffer.from(part, 'hex')))))
    ]
  });
  return transaction;
};

/** Proposes (alice), signs (bob), carries out (alice) with the given perform budget. */
const vote = async (label, propose, callNeed) => {
  const [alice, bob] = ['alice', 'bob'].map(load);
  const proposed = await send(await propose(alice), alice, `propose ${label}`);
  let id;
  for (let attempt = 0; id === undefined; attempt++) {
    try {
      id = actionIdFrom(attempt ? await getJson(`/transactions/${proposed.txHash}?withScResults=true&withLogs=true`) : proposed);
    } catch (error) {
      if (attempt >= 12) throw error;
      await sleep(2500);
    }
  }
  const sign = buildSign({ chainId: CHAIN, sender: bob.address.toBech32(), nonce: await nonceOf(bob), safe: SAFE }, id);
  await send(await sign, bob, `sign ${label} (#${id})`);
  const plan = performPlan({ name: 'SendAsyncCall', callNeed });
  console.log(`       perform budget ${plan.gasLimit.toLocaleString('en-US')}: ${plan.parts.safe} + ${plan.parts.call} + ${plan.parts.callback}`);
  const perform = buildPerform({ chainId: CHAIN, sender: alice.address.toBech32(), nonce: await nonceOf(alice), safe: SAFE }, id);
  const performed = await send(await perform, alice, `carry out ${label} (#${id})`, { budget: plan.gasLimit });
  return { id, performed };
};

const holdings = async (address, label) => {
  const tokens = await getJson(`/accounts/${address}/tokens?identifier=${TOKEN}`);
  const nfts = state.cancelKey || state.claimKey
    ? await getJson(`/accounts/${address}/nfts?collections=${[state.cancelKey, state.claimKey].filter(Boolean).join(',')}&size=50`)
    : [];
  const balance = tokens[0] ? BigInt(tokens[0].balance) : 0n;
  console.log(`${label.padEnd(10)} ${TOKEN} ${(Number(balance) / 1e18).toString().padEnd(10)} keys: ${nfts.map((n) => n.identifier).join(', ') || 'none'}`);
  return { balance, nfts };
};

const steps = {
  async deploy() {
    if (state.vest) return console.log(`copy already deployed: ${state.vest}`);
    const wasmPath = process.env.MVXVEST_WASM;
    if (!wasmPath) throw new Error('Set MVXVEST_WASM to the release .wasm of mvxvest version 4.');
    const bytecode = new Uint8Array(readFileSync(wasmPath));
    const hash = Buffer.from(blake2b(bytecode, { dkLen: 32 })).toString('hex');
    if (hash !== V4) throw new Error(`that .wasm hashes to ${hash}, not version 4 (${V4})`);
    const carol = load(OWNER); // the copy's owner
    const transaction = await vestFactory.createTransactionForDeploy(carol.address, {
      bytecode,
      gasLimit: 0n,
      arguments: [],
      isUpgradeable: true,
      isReadable: true,
      isPayable: false,
      isPayableBySmartContract: false
    });
    const onNetwork = await send(transaction, carol, 'deploy a copy of mvxvest v4');
    const deployed = (onNetwork.logs?.events ?? []).find((event) => event.identifier === 'SCDeploy');
    state.vest = deployed?.address ?? (await getJson(`/accounts/${carol.address.toBech32()}/contracts`))[0]?.address;
    save();
    const account = await getJson(`/accounts/${state.vest}`);
    console.log(`copy ${state.vest}, shard ${account.shard}, code hash ${Buffer.from(account.codeHash, 'base64').toString('hex')}, payable ${account.isPayable}, payable by SC ${account.isPayableBySmartContract}`);
  },

  async keys() {
    const carol = load(OWNER); // the copy's owner
    for (const [endpoint, view, name, ticker, field] of [
      ['issueClaimKey', 'getClaimKeyCollection', 'MvxVestClaimKey', 'VESTKEY', 'claimKey'],
      ['issueCancelKey', 'getCancelKeyCollection', 'MvxVestCancelKey', 'VESTCANCEL', 'cancelKey']
    ]) {
      let id = text((await query(state.vest, view))[0] ?? '');
      if (!id) {
        const transaction = await vestFactory.createTransactionForExecute(carol.address, {
          contract: Address.newFromBech32(state.vest),
          function: endpoint,
          arguments: [name, ticker],
          nativeTransferAmount: ISSUE_COST,
          gasLimit: SYSTEM_CALL_GAS
        });
        await send(transaction, carol, endpoint);
        for (let attempt = 0; !id && attempt < 20; attempt++) {
          await sleep(3000);
          id = text((await query(state.vest, view))[0] ?? '');
        }
        if (!id) throw new Error(`${endpoint} completed but ${view} is still empty`);
      }
      state[field] = id;
      save();
      console.log(`${field}: ${id}`);
    }
    console.log(`fees: ${BigInt('0x' + ((await query(state.vest, 'getFee'))[0] || '0'))} EGLD units, ${BigInt('0x' + ((await query(state.vest, 'getTokenFee'))[0] || '0'))} bps`);
  },

  async create() {
    if (state.created) return console.log(`already created: vestings ${state.created.ids.join(', ')}`);
    const [erin, frank, carol] = ['erin', 'frank', 'carol'].map(load);
    const now = Math.floor(Date.now() / 1000);
    // First tranche in ~8 minutes, so the claim and the cancel run today;
    // the second in two and three days.
    const first = now + 8 * 60;
    const schedule = (tranches) => ({
      start: first,
      cliff: first,
      cliff_amount: 0n,
      end: tranches[tranches.length - 1].time,
      curve: { name: 'Tranches', fields: { 0: tranches } }
    });
    const entries = [
      [erin.address, 10n * UNIT, schedule([{ time: first, amount: 4n * UNIT }, { time: first + 2 * 86400, amount: 6n * UNIT }])],
      [frank.address, 6n * UNIT, schedule([{ time: first, amount: 2n * UNIT }, { time: first + 3 * 86400, amount: 4n * UNIT }])]
    ];
    const total = 16n * UNIT;
    const label = 'mvxsafe probe';
    // The same call from a wallet, to get its encoding and, from carol in the
    // copy's shard, what it needs: the network cannot simulate it as the safe.
    const asWallet = await vestFactory.createTransactionForExecute(carol.address, {
      contract: Address.newFromBech32(state.vest),
      function: 'createBatch',
      gasLimit: 0n,
      arguments: [true, label, ...entries],
      tokenTransfers: [new TokenTransfer({ token: new Token({ identifier: TOKEN }), amount: total })]
    });
    const data = Buffer.from(asWallet.data).toString();
    const parts = data.split('@');
    if (parts[0] !== 'ESDTTransfer' || text(parts[3]) !== 'createBatch') throw new Error(`unexpected encoding: ${data.slice(0, 80)}`);
    const { need, how } = SAME_SHARD
      ? await measureCall(api, { chainId: CHAIN, safe: SAFE, to: state.vest, egld: 0n, data })
      : await measureCall(api, { chainId: CHAIN, safe: carol.address.toBech32(), to: state.vest, egld: 0n, data });
    console.log(`       createBatch ${SAME_SHARD ? 'as the safe' : "from a wallet in the copy's shard"}: need ${need?.toLocaleString('en-US') ?? 'unknown'} (${how}); data ${data.length} bytes`);
    const { id, performed } = await vote('createBatch of 2 cancelable vestings', (alice) => proposeAsync(alice, state.vest, parts), need ?? undefined);
    state.created = { action: id, perform: performed.txHash, first, ids: [] };
    save();
    // What the copy returned to the safe: the ids, and the keys it sent.
    await sleep(6000);
    const ids = (await getJson(`/accounts/${state.vest}/transactions?size=5&function=createBatch`)).length;
    console.log(`       copy saw ${ids} createBatch call(s)`);
    const count = Number(BigInt('0x' + ((await query(state.vest, 'getVestingCountByCreator', [Address.newFromBech32(SAFE).toHex()]))[0] || '0')));
    const list = await query(state.vest, 'getVestingsByCreator', [Address.newFromBech32(SAFE).toHex(), '00', count.toString(16).padStart(2, '0')]);
    state.created.ids = list.map((hex) => Number(BigInt('0x' + (hex || '0'))));
    save();
    console.log(`       vestings created by the safe: ${state.created.ids.join(', ') || 'none'}`);
    await steps.status();
  },

  /** carol, the copy's owner, sets its fees: fees <EGLD units per vesting> <bps>. */
  async fees() {
    const carol = load(OWNER); // the copy's owner
    const [egld, bps] = [BigInt(process.argv[3] ?? '0'), Number(process.argv[4] ?? '0')];
    for (const [fn, value] of [['setFee', egld], ['setTokenFee', bps]]) {
      const transaction = await vestFactory.createTransactionForExecute(carol.address, {
        contract: Address.newFromBech32(state.vest),
        function: fn,
        gasLimit: 0n,
        arguments: [value]
      });
      await send(transaction, carol, `${fn} ${value}`);
    }
    console.log(`fees now: ${BigInt('0x' + ((await query(state.vest, 'getFee'))[0] || '0'))} EGLD units, ${BigInt('0x' + ((await query(state.vest, 'getTokenFee'))[0] || '0'))} bps`);
  },

  /**
   * The safe pays the vesting AND both fees: the token (total plus its token
   * fee) and EGLD (the fee per vesting) in one MultiESDTNFTTransfer, which a
   * contract runs on its own account: the call goes to the safe itself.
   */
  async createfee() {
    const [erin, carol] = ['erin', 'carol'].map(load);
    const fee = BigInt('0x' + ((await query(state.vest, 'getFee'))[0] || '0'));
    const bps = BigInt('0x' + ((await query(state.vest, 'getTokenFee'))[0] || '0'));
    const first = Math.floor(Date.now() / 1000) + 8 * 60;
    const total = 2n * UNIT;
    const tranches = [{ time: first, amount: UNIT }, { time: first + 86400, amount: UNIT }];
    const entries = [[erin.address, total, { start: first, cliff: first, cliff_amount: 0n, end: first + 86400, curve: { name: 'Tranches', fields: { 0: tranches } } }]];
    const tokenFee = (total * bps) / 10000n;
    console.log(`       fees read: ${fee} EGLD units per vesting, ${bps} bps; paying ${total + tokenFee} ${TOKEN} units and ${fee} EGLD units`);
    const asWallet = await vestFactory.createTransactionForExecute(carol.address, {
      contract: Address.newFromBech32(state.vest),
      function: 'createBatch',
      gasLimit: 0n,
      arguments: [true, 'mvxsafe probe, fees paid', ...entries],
      tokenTransfers: [new TokenTransfer({ token: new Token({ identifier: TOKEN }), amount: total + tokenFee }), TokenTransfer.newFromNativeAmount(fee)]
    });
    const data = Buffer.from(asWallet.data).toString();
    const parts = data.split('@');
    if (parts[0] !== 'MultiESDTNFTTransfer') throw new Error(`unexpected encoding: ${data.slice(0, 80)}`);
    console.log(`       ${parts.slice(0, 10).map((p, i) => (i === 0 ? p : i === 1 ? 'copy' : /^[0-9a-f]+$/.test(p) && Buffer.from(p, 'hex').toString().match(/^[A-Za-z0-9-]+$/) ? Buffer.from(p, 'hex').toString() : p)).join(' @ ')} ...`);
    const { need, how } = SAME_SHARD
      ? await measureCall(api, { chainId: CHAIN, safe: SAFE, to: SAFE, egld: 0n, data })
      : await measureCall(api, { chainId: CHAIN, safe: carol.address.toBech32(), to: carol.address.toBech32(), egld: 0n, data });
    console.log(`       the same ${SAME_SHARD ? 'as the safe' : "from a wallet in the copy's shard"}: need ${need?.toLocaleString('en-US') ?? 'unknown'} (${how})`);
    const accruedBefore = BigInt('0x' + ((await query(state.vest, 'getFeesAccrued'))[0] || '0'));
    const before = await holdings(SAFE, 'safe');
    const egldBefore = BigInt((await getJson(`/accounts/${SAFE}`)).balance);
    const { id, performed } = await vote('createBatch paying both fees', (alice) => proposeAsync(alice, SAFE, parts), need ?? undefined);
    await sleep(8000);
    const after = await holdings(SAFE, 'safe');
    const egldAfter = BigInt((await getJson(`/accounts/${SAFE}`)).balance);
    const accruedAfter = BigInt('0x' + ((await query(state.vest, 'getFeesAccrued'))[0] || '0'));
    state.createdWithFees = { action: id, perform: performed.txHash, fee: fee.toString(), bps: bps.toString() };
    save();
    console.log(`       safe paid ${before.balance - after.balance} ${TOKEN} units and ${egldBefore - egldAfter} EGLD units; copy's EGLD fees accrued +${accruedAfter - accruedBefore}`);
    console.log(`       new cancel keys in the safe: ${after.nfts.filter((n) => !before.nfts.some((b) => b.identifier === n.identifier)).map((n) => n.identifier).join(', ') || 'none'}`);
  },

  async status() {
    const [erin, frank] = ['erin', 'frank'].map(load);
    console.log(`copy ${state.vest} (shard ${shardOf(state.vest)}), safe ${SAFE} (shard ${shardOf(SAFE)})`);
    await holdings(SAFE, 'safe');
    await holdings(erin.address.toBech32(), 'erin');
    await holdings(frank.address.toBech32(), 'frank');
    await holdings(state.vest, 'copy');
  },

  async claim() {
    const erin = load('erin');
    const wait = state.created.first + 10 - Math.floor(Date.now() / 1000);
    if (wait > 0) {
      console.log(`       first tranche vests in ${wait}s; waiting`);
      await sleep(wait * 1000);
    }
    const { nfts } = await holdings(erin.address.toBech32(), 'erin');
    const key = nfts.find((nft) => nft.collection === state.claimKey);
    if (!key) throw new Error('erin holds no claim key');
    const transaction = await vestFactory.createTransactionForExecute(erin.address, {
      contract: Address.newFromBech32(state.vest),
      function: 'claim',
      gasLimit: 0n,
      arguments: [],
      tokenTransfers: [new TokenTransfer({ token: new Token({ identifier: state.claimKey, nonce: BigInt(key.nonce) }), amount: 1n })]
    });
    await send(transaction, erin, `erin claims with ${key.identifier}`);
    await steps.status();
  },

  async cancel() {
    const erin = load('erin');
    const before = await holdings(SAFE, 'safe');
    // The cancel key of erin's vesting: the one whose vesting names erin.
    let chosen;
    for (const nft of before.nfts.filter((n) => n.collection === state.cancelKey)) {
      const id = Number(BigInt('0x' + ((await query(state.vest, 'getVestingByCancelNonce', [BigInt(nft.nonce).toString(16).padStart(2, '0')]))[0] || '0')));
      const view = await query(state.vest, 'getVesting', [id.toString(16).padStart(2, '0')]);
      if (view[0]?.includes(erin.address.toHex())) chosen = { nft, id };
    }
    if (!chosen) throw new Error("the safe holds no cancel key for erin's vesting");
    console.log(`       cancelling vesting ${chosen.id} with ${chosen.nft.identifier}`);
    // A contract sends an NFT by running ESDTNFTTransfer on its own account,
    // with the receiver and the function after the token: the call goes to
    // the safe itself. sdk-core's own encoding of the same call from a wallet:
    const asWallet = await vestFactory.createTransactionForExecute(erin.address, {
      contract: Address.newFromBech32(state.vest),
      function: 'cancel',
      gasLimit: 0n,
      arguments: [],
      tokenTransfers: [new TokenTransfer({ token: new Token({ identifier: state.cancelKey, nonce: BigInt(chosen.nft.nonce) }), amount: 1n })]
    });
    const parts = Buffer.from(asWallet.data).toString().split('@');
    if (parts[0] !== 'ESDTNFTTransfer' || text(parts[5]) !== 'cancel') throw new Error(`unexpected encoding: ${parts.join('@').slice(0, 80)}`);
    // Not measurable as the safe (another shard): a cancel of one key needs
    // a few million; 20M is ample and the rest is refunded.
    let cancelNeed = 20_000_000n;
    if (SAME_SHARD) {
      const measured = await measureCall(api, { chainId: CHAIN, safe: SAFE, to: SAFE, egld: 0n, data: parts.join('@') });
      console.log(`       cancel as the safe: need ${measured.need?.toLocaleString('en-US') ?? 'unknown'} (${measured.how})`);
      if (measured.need) cancelNeed = measured.need;
    }
    const { id, performed } = await vote(`cancel vesting ${chosen.id}`, (alice) => proposeAsync(alice, SAFE, parts), cancelNeed);
    state.cancelled = { action: id, perform: performed.txHash, vesting: chosen.id, key: chosen.nft.identifier };
    save();
    await sleep(8000);
    const after = await holdings(SAFE, 'safe');
    console.log(`       the safe got back ${(Number(after.balance - before.balance) / 1e18).toString()} ${TOKEN}`);
    await steps.status();
  }
};

const step = process.argv[2];
if (!steps[step]) {
  console.error(`Steps: ${Object.keys(steps).join(', ')}`);
  process.exit(1);
}
await steps[step]();
