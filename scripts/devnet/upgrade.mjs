// The upgrade-and-call rehearsal on devnet (handoff from mvxvest, 13 Oct 2026),
// with throwaway keys and the SAME builders and gas rules the app ships
// (src/multisig/legacyCalls.js, src/multisig/gas.js). Only the signer differs:
// in the app a wallet signs, here a devnet test key does, and for the guarded
// wallet a second test key co-signs as its guardian.
//
//   MVXVEST_WASM=<mvxvest .wasm> node scripts/devnet/upgrade.mjs <step>
//
//   node scripts/devnet/upgrade.mjs              every step not done yet
//   node scripts/devnet/upgrade.mjs again        the setFee and upgrade votes
//                                                once more, on the same contracts
//   node scripts/devnet/upgrade.mjs swap         upgrade to a different build
//                                                and back, to see the code change
//   node scripts/devnet/upgrade.mjs guarded      the guarded wallet's turn, once
//                                                its guardian is active
//   node scripts/devnet/upgrade.mjs to <source> <expected code hash>
//                                                upgrade the copy to a source someone
//                                                else staged, after the form's checks
//   node scripts/devnet/upgrade.mjs call <function> [kind:value ...]
//                                                a call on the copy, for example
//                                                call setTokenFee number:100
//   node scripts/devnet/upgrade.mjs redcards     puts the upgrades mvxsafe refuses
//                                                on chain anyway, written by hand
//                                                as another tool could, so the
//                                                safe page can show them in red
//   node scripts/devnet/upgrade.mjs cleanup      takes back the signatures on
//                                                every pending action and discards it
//
// The layout copies mainnet: the safe in shard 1, mvxvest in shard 0, so every
// perform is a cross-shard call. What was created is kept in
// scripts/devnet/upgrade-state.json and reused; each transaction hash is
// printed and appended to that file.
//
// Keys live in ~/.mvxsafe-devnet, devnet only, no value, never in git.
import {
  Account,
  Address,
  AddressValue,
  ApiNetworkProvider,
  BigUIntValue,
  CodeMetadata,
  CodeMetadataValue,
  SmartContractController,
  SmartContractTransactionsFactory,
  Transaction,
  TransactionsFactoryConfig,
  TransferTransactionsFactory,
  U32Value,
  VariadicValue
} from '@multiversx/sdk-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { handOverGas, measureCall, performPlan, settleGas } from '../../src/multisig/gas.js';
import {
  buildDeploySafe,
  buildDeploySource,
  buildDiscard,
  buildHandOver,
  buildPerform,
  buildProposeCall,
  buildProposeUpgrade,
  buildSign,
  buildUnsign,
  codeHashOf,
  legacyAbi,
  metadataFromHex,
  metadataToHex,
  normalizeCodeHash,
  predictSafeAddress,
  shardOf
} from '../../src/multisig/legacyCalls.js';

const KEYS = `${homedir()}/.mvxsafe-devnet`;
const STATE_FILE = 'scripts/devnet/upgrade-state.json';
// The release .wasm of mvxvest, from its reproducible build.
const WASM = process.env.MVXVEST_WASM;
if (!WASM) {
  console.error('Set MVXVEST_WASM to the path of the mvxvest .wasm to rehearse with.');
  process.exit(1);
}
const API = 'https://devnet-api.multiversx.com';
const CHAIN = 'D';
const api = new ApiNetworkProvider(API, { clientName: 'mvxsafe-devnet-test' });
const factory = new SmartContractTransactionsFactory({ config: new TransactionsFactoryConfig({ chainID: CHAIN }) });
const transfers = new TransferTransactionsFactory({ config: new TransactionsFactoryConfig({ chainID: CHAIN }) });

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

const guardianOf = async (address) => {
  const account = await getJson(`/accounts/${address}?withGuardianInfo=true`);
  return account.isGuarded ? account.activeGuardianAddress : '';
};

/**
 * Sends one transaction the way the app does: nonce from the network, the
 * guardian applied, then the gas (simulated, or the budget), then signed. A
 * guarded sender is co-signed by its guardian's test key.
 */
const send = async (transaction, signer, label, { budget, guardianKey } = {}) => {
  const sender = signer.address.toBech32();
  transaction.nonce = BigInt((await api.getAccount(signer.address)).nonce);
  const guardian = await guardianOf(sender);
  await settleGas(transaction, { provider: api, guardian, budget });
  transaction.signature = await signer.signTransaction(transaction);
  if (guardian) {
    if (!guardianKey || guardianKey.address.toBech32() !== guardian) {
      throw new Error(`${sender} is guarded by ${guardian}, whose key this run does not have`);
    }
    transaction.guardianSignature = await guardianKey.signTransaction(transaction);
  }
  const hash = await api.sendTransaction(transaction);
  let onNetwork;
  for (let at = 0; at < 120; at++) {
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
  const ok = onNetwork?.status === 'success';
  const events = (onNetwork?.logs?.events ?? []).map((event) => event.identifier);
  for (const result of onNetwork?.results ?? []) {
    for (const event of result.logs?.events ?? []) events.push(event.identifier);
  }
  const failedInside = events.some((name) => /signalError|internalVMErrors/.test(name));
  const gasLine = `gas ${Number(transaction.gasLimit).toLocaleString('en-US')}${guardian ? ' (guarded)' : ''}`;
  console.log(`${ok && !failedInside ? '  ok  ' : ' FAIL '} ${label}  ${hash}  ${gasLine}`);
  state.hashes.push({ label, hash, gasLimit: transaction.gasLimit.toString(), ok: ok && !failedInside, guarded: Boolean(guardian) });
  save();
  if (!ok || failedInside) {
    throw new Error(`${label} did not succeed (${onNetwork?.status ?? 'no answer'}; events: ${events.join(', ')}): ${hash}`);
  }
  return onNetwork;
};

/** The action id a propose created, from the contract's answer "@6f6b@<id>". */
const actionIdFrom = (onNetwork) => {
  for (const result of onNetwork.results ?? []) {
    const data = result.data ? Buffer.from(result.data, 'base64').toString() : '';
    const parts = data.split('@').filter(Boolean);
    if (parts[0] === '6f6b' && parts[1]) return parseInt(parts[1], 16);
  }
  for (const event of onNetwork.logs?.events ?? []) {
    if (event.identifier !== 'writeLog') continue;
    const data = event.data ? Buffer.from(event.data, 'base64').toString() : '';
    const parts = data.split('@').filter(Boolean);
    if (parts[0] === '6f6b' && parts[1]) return parseInt(parts[1], 16);
  }
  throw new Error(`no action id in ${onNetwork.txHash}`);
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
const asNumber = (hex) => BigInt(`0x${hex || '0'}`);

const facts = async (address) => {
  const account = await getJson(`/accounts/${address}`);
  return {
    shard: account.shard,
    owner: account.ownerAddress,
    codeHash: account.codeHash ? normalizeCodeHash(account.codeHash) : null,
    codeBytes: account.code ? account.code.length / 2 : 0,
    metadata: account.codeHash
      ? metadataToHex({
          upgradeable: account.isUpgradeable,
          readable: account.isReadable,
          payable: account.isPayable,
          payableBySc: account.isPayableBySmartContract
        })
      : null,
    balance: BigInt(account.balance)
  };
};

const context = async (signer, safe) => ({
  chainId: CHAIN,
  sender: signer.address.toBech32(),
  nonce: Number((await api.getAccount(signer.address)).nonce),
  safe
});

/**
 * The gas a perform gets, worked out as the safe page works it out: a budget
 * from what the call needs as the safe, or from the source's code size, or a
 * simulation for what stays inside the safe.
 */
const performBudget = async (safe, action) => {
  if (action.name === 'SCUpgradeFromSource') {
    const source = await facts(action.source);
    return performPlan({ name: action.name, codeBytes: source.codeBytes });
  }
  if (action.name === 'SendAsyncCall') {
    // Throws when the call fails as the safe: no reason to go on then.
    const { need, how } = await measureCall(api, { chainId: CHAIN, safe, to: action.to, egld: 0n, data: action.data });
    console.log(`       as the safe: need ${need?.toLocaleString('en-US') ?? 'unknown'} (${how})`);
    return performPlan({ name: action.name, callNeed: need });
  }
  return performPlan({ name: action.name });
};

/** Proposes, collects the other signature, carries it out. Returns the action id. */
const vote = async (safe, propose, action, [proposer, signer, performer], label, keys = {}) => {
  const proposed = await send(await propose(await context(proposer, safe)), proposer, `propose ${label}`, {
    guardianKey: keys[proposer.address.toBech32()]
  });
  // The API can say "success" before it has indexed the contract's answer.
  let id;
  for (let attempt = 0; id === undefined; attempt++) {
    try {
      id = actionIdFrom(attempt ? await getJson(`/transactions/${proposed.txHash}?withScResults=true&withLogs=true`) : proposed);
    } catch (error) {
      if (attempt >= 12) throw error;
      await sleep(2500);
    }
  }
  await send(await buildSign(await context(signer, safe), id), signer, `sign ${label} (#${id})`, {
    guardianKey: keys[signer.address.toBech32()]
  });
  const plan = await performBudget(safe, action);
  if (!plan.simulate) {
    console.log(
      `       perform budget ${plan.gasLimit.toLocaleString('en-US')}: ${plan.parts.safe} + ${plan.parts.call} + ${plan.parts.callback}`
    );
  }
  await send(await buildPerform(await context(performer, safe), id), performer, `carry out ${label} (#${id})`, {
    budget: plan.simulate ? undefined : plan.gasLimit,
    guardianKey: keys[performer.address.toBech32()]
  });
  return id;
};

const run = async () => {
  const [alice, bob, carol, dave, guardian] = ['alice', 'bob', 'carol', 'dave', 'guardian'].map(load);
  const who = { alice, bob, carol, dave };
  for (const [name, account] of Object.entries(who)) {
    console.log(`${name.padEnd(6)} ${account.address.toBech32()}  shard ${shardOf(account.address.toBech32())}`);
  }
  const wasm = new Uint8Array(readFileSync(WASM));
  const wasmHash = codeHashOf(wasm);
  console.log(`mvxvest.wasm ${wasm.length} bytes, code hash ${wasmHash}`);

  // 1. A 2-of-3 safe in shard 1, deployed by alice, owning itself.
  if (!state.safe) {
    const { nonce } = await context(alice, '');
    const safe = predictSafeAddress(alice.address.toBech32(), nonce);
    const bytecode = new Uint8Array(readFileSync('public/contracts/multisig.wasm'));
    const board = [alice, bob, dave].map((account) => account.address.toBech32());
    // As createSafe does it: the deploy simulated, the handover at the fixed cost.
    await send(await buildDeploySafe({ chainId: CHAIN, sender: alice.address.toBech32(), nonce }, { bytecode, quorum: 2, board }), alice, 'deploy a 2-of-3 safe');
    const handOver = await buildHandOver({ chainId: CHAIN, sender: alice.address.toBech32(), nonce: nonce + 1, safe });
    await send(handOver, alice, 'hand the safe to itself', { budget: handOverGas(handOver.data.length) });
    state.safe = safe;
    save();
  }
  const safe = state.safe;
  console.log(`safe   ${safe}  shard ${shardOf(safe)}`);

  // Enough EGLD in the safe for the network to try a call as the safe.
  if ((await facts(safe)).balance < 20000000000000000n) {
    await send(
      await transfers.createTransactionForNativeTokenTransfer(alice.address, { receiver: new Address(safe), nativeAmount: 50000000000000000n }),
      alice,
      'send 0.05 xEGLD into the safe'
    );
  }

  // 2. A devnet copy of mvxvest in shard 0, deployed by carol, handed to the safe.
  if (!state.vest) {
    const { nonce } = await context(carol, '');
    const vest = predictSafeAddress(carol.address.toBech32(), nonce);
    const deploy = await factory.createTransactionForDeploy(carol.address, {
      bytecode: wasm,
      gasLimit: 0n,
      arguments: [],
      isUpgradeable: true,
      isReadable: true,
      isPayable: false,
      isPayableBySmartContract: false
    });
    await send(deploy, carol, 'deploy the mvxvest copy (0500, no arguments)');
    const handOver = new Transaction({
      sender: carol.address,
      receiver: new Address(vest),
      value: 0n,
      gasLimit: 0n,
      chainID: CHAIN,
      data: new TextEncoder().encode(`ChangeOwnerAddress@${new Address(safe).toHex()}`)
    });
    await send(handOver, carol, 'hand the mvxvest copy to the safe');
    state.vest = vest;
    save();
  }
  const vest = state.vest;
  const vestFacts = await facts(vest);
  console.log(`vest   ${vest}  shard ${vestFacts.shard}  owner ${vestFacts.owner === safe ? 'the safe' : vestFacts.owner}  ${vestFacts.metadata}  ${vestFacts.codeHash}`);

  if (process.argv[2] === 'again') {
    delete state.setFee;
    delete state.upgrade;
  }
  if (process.argv[2] === 'guarded') return guardedTurn({ safe, vest, alice, dave, guardian, wasm, wasmHash });
  if (process.argv[2] === 'to') return upgradeTo({ safe, vest, alice, bob, source: process.argv[3], expected: process.argv[4] });
  if (process.argv[2] === 'call') {
    const args = process.argv.slice(4).map((item) => {
      const [kind, ...rest] = item.split(':');
      return { kind, value: rest.join(':') };
    });
    return callVest({ safe, vest, alice, bob, functionName: process.argv[3], args });
  }
  if (process.argv[2] === 'redcards') return redCards({ safe, vest, alice });
  if (process.argv[2] === 'cleanup') return cleanUp({ safe, who });
  if (process.argv[2] === 'swap') return swapCode({ safe, vest, alice, bob, wasmHash });

  // 3. setFee 0.01 EGLD, the vote mvxvest needs.
  if (!state.setFee) {
    const data = `setFee@2386f26fc10000`;
    const id = await vote(
      safe,
      (ctx) => buildProposeCall(ctx, { to: vest, functionName: 'setFee', args: [{ kind: 'egld', value: '0.01' }] }),
      { name: 'SendAsyncCall', to: vest, data },
      [alice, bob, bob],
      'setFee 0.01 EGLD'
    );
    state.setFee = id;
    save();
  }
  const fee = asNumber((await query(vest, 'getFee'))[0]);
  console.log(`  getFee = ${fee} (${Number(fee) / 1e18} EGLD)`);
  if (fee !== 10n ** 16n) throw new Error('getFee is not 0.01 EGLD');

  // 4. The failure paths, refused before anything is sent.
  for (const [what, attempt] of [
    ['a source in shard 0, the target itself', () => buildProposeUpgrade({ chainId: CHAIN, sender: alice.address.toBech32(), nonce: 0, safe }, { target: vest, source: vest, metadata: '0500' })],
    ['metadata 0400, without upgradeable', () => buildProposeUpgrade({ chainId: CHAIN, sender: alice.address.toBech32(), nonce: 0, safe }, { target: vest, source: state.source ?? predictSafeAddress(alice.address.toBech32(), 1), metadata: '0400' })]
  ]) {
    try {
      await attempt();
      throw new Error(`${what} was NOT refused`);
    } catch (error) {
      if (/NOT refused/.test(error.message)) throw error;
      console.log(`  refused: ${what}: ${error.message.slice(0, 110)}...`);
    }
  }

  // 5. A source in the safe's shard, from the same wasm, not upgradeable.
  if (!state.source) {
    const { nonce } = await context(alice, '');
    const source = predictSafeAddress(alice.address.toBech32(), nonce);
    await send(await buildDeploySource({ chainId: CHAIN, sender: alice.address.toBech32(), nonce }, { bytecode: wasm }), alice, 'deploy the source in shard 1');
    state.source = source;
    save();
  }
  const sourceFacts = await facts(state.source);
  console.log(`source ${state.source}  shard ${sourceFacts.shard}  ${sourceFacts.metadata}  ${sourceFacts.codeHash}  ${sourceFacts.codeBytes} bytes`);
  if (sourceFacts.codeHash !== wasmHash) throw new Error('the source does not run the file');
  if (sourceFacts.shard !== shardOf(safe)) throw new Error('the source is not in the safe shard');

  // 6. The upgrade, with the target's own metadata.
  if (!state.upgrade) {
    const metadata = metadataFromHex(vestFacts.metadata);
    const id = await vote(
      safe,
      (ctx) => buildProposeUpgrade(ctx, { target: vest, source: state.source, metadata }),
      { name: 'SCUpgradeFromSource', source: state.source },
      [alice, bob, alice],
      'upgrade mvxvest from the source'
    );
    state.upgrade = id;
    save();
  }

  // 7. Afterwards: same code, same metadata, the fee still answers.
  const after = await facts(vest);
  const feeAfter = asNumber((await query(vest, 'getFee'))[0]);
  console.log(`after: code ${after.codeHash === wasmHash ? 'unchanged' : 'CHANGED'} (${after.codeHash}), metadata ${after.metadata}, owner ${after.owner === safe ? 'the safe' : after.owner}, getFee ${feeAfter}`);
  if (after.codeHash !== wasmHash || after.metadata !== '0500' || feeAfter !== 10n ** 16n) throw new Error('the contract is not as it should be');

  // The upgrade's own events, to show it really ran in shard 0.
  const performed = state.hashes.filter((entry) => entry.label.startsWith('carry out upgrade')).at(-1);
  if (performed) {
    const raw = await getJson(`/transactions/${performed.hash}?withScResults=true&withLogs=true`);
    const names = [...(raw.logs?.events ?? []), ...(raw.results ?? []).flatMap((r) => r.logs?.events ?? [])].map((e) => e.identifier);
    console.log(`  upgrade events: ${[...new Set(names)].join(', ')}`);
  }

  console.log('\nALL STEPS PASSED');
};

/**
 * An upgrade of the copy to a source staged by someone else, held to what the
 * upgrade form checks first: the source in the safe's shard, holding code,
 * not upgradeable, and its code hash the expected one. The metadata stays
 * what the copy has today.
 */
const upgradeTo = async ({ safe, vest, alice, bob, source, expected }) => {
  const want = normalizeCodeHash(expected);
  if (!want) throw new Error('give the expected code hash, 64 hex characters');
  const found = await facts(source);
  const before = await facts(vest);
  console.log(`source ${source}  shard ${found.shard}  ${found.metadata}  ${found.codeHash}  ${found.codeBytes} bytes`);
  if (found.shard !== shardOf(safe)) throw new Error(`the source is in shard ${found.shard}, not the safe's`);
  if (found.codeHash !== want) throw new Error('the source does not hold the expected code');
  if (metadataFromHex(found.metadata).upgradeable) throw new Error('the source is upgradeable');
  await vote(
    safe,
    (ctx) => buildProposeUpgrade(ctx, { target: vest, source, metadata: metadataFromHex(before.metadata) }),
    { name: 'SCUpgradeFromSource', source },
    [alice, bob, alice],
    `upgrade mvxvest to ${want.slice(0, 8)}...`
  );
  const after = await facts(vest);
  const fee = asNumber((await query(vest, 'getFee'))[0]);
  console.log(`after: code ${after.codeHash} (${after.codeHash === want ? 'the expected code' : 'NOT the expected code'}), metadata ${after.metadata}, owner ${after.owner === safe ? 'the safe' : after.owner}, getFee ${fee}`);
  if (after.codeHash !== want || after.metadata !== before.metadata || after.owner !== safe) throw new Error('the contract is not as it should be');
  console.log('\nUPGRADE PASSED');
};

/** One call on the copy, voted and carried out as the app does it. */
const callVest = async ({ safe, vest, alice, bob, functionName, args }) => {
  const proposal = await buildProposeCall(await context(alice, safe), { to: vest, functionName, args });
  const data = Buffer.from(proposal.data).toString().split('@').slice(3).map((part, at) => (at === 0 ? Buffer.from(part, 'hex').toString() : part)).join('@');
  console.log(`  proposing ${data}`);
  await vote(safe, async () => proposal, { name: 'SendAsyncCall', to: vest, data }, [alice, bob, bob], `${functionName}(${args.map((arg) => arg.value).join(', ')})`);
  console.log('\nCALL PASSED');
};

/**
 * The two upgrades mvxsafe refuses to propose, written by hand with the legacy
 * ABI and no checks, and a valid fee change beside them: what a board member
 * would find if someone proposed them with another tool. The safe page must
 * show the first two in red before anyone signs.
 */
const redCards = async ({ safe, vest, alice }) => {
  const legacy = new SmartContractTransactionsFactory({ config: new TransactionsFactoryConfig({ chainID: CHAIN }), abi: legacyAbi });
  const raw = async (source, metadata) =>
    legacy.createTransactionForExecute(alice.address, {
      contract: new Address(safe),
      function: 'proposeSCUpgradeFromSource',
      gasLimit: 0n,
      arguments: [
        new AddressValue(new Address(vest)),
        new BigUIntValue(0n),
        new AddressValue(new Address(source)),
        new CodeMetadataValue(new CodeMetadata(metadata.upgradeable, metadata.readable, false, false)),
        VariadicValue.fromItems()
      ]
    });
  state.redcards = [];
  for (const [label, transaction] of [
    ['propose by hand: an upgrade whose source is in shard 0', await raw(vest, { upgradeable: true, readable: true })],
    ['propose by hand: an upgrade that drops "upgradeable"', await raw(state.source, { upgradeable: false, readable: true })],
    ['propose setFee 0.02 EGLD', await buildProposeCall(await context(alice, safe), { to: vest, functionName: 'setFee', args: [{ kind: 'egld', value: '0.02' }] })]
  ]) {
    const proposed = await send(transaction, alice, label);
    let id;
    for (let attempt = 0; id === undefined; attempt++) {
      try {
        id = actionIdFrom(attempt ? await getJson(`/transactions/${proposed.txHash}?withScResults=true&withLogs=true`) : proposed);
      } catch (error) {
        if (attempt >= 12) throw error;
        await sleep(2500);
      }
    }
    console.log(`       action #${id}`);
    state.redcards.push(id);
    save();
  }
};

/** Every pending action: each signer takes back their signature, then it is discarded. */
const cleanUp = async ({ safe, who }) => {
  const controller = new SmartContractController({ chainID: CHAIN, networkProvider: api, abi: legacyAbi });
  const [pending] = await controller.query({ contract: new Address(safe), function: 'getPendingActionFullInfo', arguments: [] });
  const byAddress = Object.fromEntries(Object.values(who).map((account) => [account.address.toBech32(), account]));
  for (const action of Array.isArray(pending) ? pending : []) {
    const id = Number(action.action_id.toString());
    for (const signer of action.signers.map((value) => value.toBech32())) {
      const account = byAddress[signer];
      if (!account) throw new Error(`#${id} is signed by ${signer}, whose key this run does not have`);
      await send(await buildUnsign(await context(account, safe), id), account, `unsign #${id}`);
    }
    await send(await buildDiscard(await context(who.alice, safe), id), who.alice, `discard #${id}`);
  }
  console.log('\nNOTHING PENDING');
};

/**
 * Proof that an upgrade with the measured budget really replaces the code: the
 * copy is upgraded to a DIFFERENT build (MVXVEST_WASM_B, for example mvxvest's
 * local, non-reproducible build) and its code hash must change to that build's,
 * then upgraded back and the hash must return. Same code both ways would prove
 * nothing, since the hash would not move.
 */
const swapCode = async ({ safe, vest, alice, bob, wasmHash }) => {
  const otherFile = process.env.MVXVEST_WASM_B;
  if (!otherFile) throw new Error('Set MVXVEST_WASM_B to the path of a second, different mvxvest build.');
  const other = new Uint8Array(readFileSync(otherFile));
  const otherHash = codeHashOf(other);
  if (otherHash === wasmHash) throw new Error('the second build is the same code');
  console.log(`second build ${other.length} bytes, code hash ${otherHash}`);
  if (!state.sourceB) {
    const { nonce } = await context(alice, '');
    const source = predictSafeAddress(alice.address.toBech32(), nonce);
    await send(await buildDeploySource({ chainId: CHAIN, sender: alice.address.toBech32(), nonce }, { bytecode: other }), alice, 'deploy the second build as a source in shard 1');
    state.sourceB = source;
    save();
  }
  for (const [source, hash, label] of [
    [state.sourceB, otherHash, 'upgrade mvxvest to the second build'],
    [state.source, wasmHash, 'upgrade mvxvest back to the release build']
  ]) {
    await vote(
      safe,
      (ctx) => buildProposeUpgrade(ctx, { target: vest, source, metadata: metadataFromHex('0500') }),
      { name: 'SCUpgradeFromSource', source },
      [alice, bob, alice],
      label
    );
    const after = await facts(vest);
    const fee = asNumber((await query(vest, 'getFee'))[0]);
    console.log(`  code now ${after.codeHash} (${after.codeHash === hash ? 'as expected' : 'NOT the one expected'}), metadata ${after.metadata}, getFee ${fee}`);
    if (after.codeHash !== hash || after.metadata !== '0500') throw new Error('the upgrade did not replace the code');
  }
  console.log('\nSWAP STEPS PASSED');
};

/**
 * Everything again from a wallet whose guardian must co-sign every
 * transaction, as two of the three mainnet signers have: dave deploys a
 * source, proposes, signs and carries out calls and an upgrade, then takes a
 * signature back and discards. Each transaction gets its guardian before the
 * simulation and 50,000 more after it, budgets included (settleGas).
 */
const guardedTurn = async ({ safe, vest, alice, dave, guardian, wasm, wasmHash }) => {
  const daveAddress = dave.address.toBech32();
  const keys = { [daveAddress]: guardian };
  if (!(await guardianOf(daveAddress))) {
    const data = await getJson(`/accounts/${daveAddress}?withGuardianInfo=true`);
    console.log('dave guardian info', JSON.stringify(data));
    // Active but not yet switched on: GuardAccount, sent unguarded.
    const guard = new Transaction({
      sender: dave.address,
      receiver: dave.address,
      value: 0n,
      gasLimit: 0n,
      chainID: CHAIN,
      data: new TextEncoder().encode('GuardAccount')
    });
    await send(guard, dave, 'dave switches its guardian on');
  }
  console.log(`dave is guarded by ${await guardianOf(daveAddress)}`);

  // A source deployed from the guarded wallet, which is in the safe's shard.
  if (!state.guardedSource) {
    const { nonce } = await context(dave, '');
    const source = predictSafeAddress(daveAddress, nonce);
    await send(await buildDeploySource({ chainId: CHAIN, sender: daveAddress, nonce }, { bytecode: wasm }), dave, 'dave deploys a source (guarded)', { guardianKey: guardian });
    state.guardedSource = source;
    save();
  }
  const source = await facts(state.guardedSource);
  console.log(`  dave's source ${state.guardedSource}: ${source.codeHash === wasmHash ? 'the release code' : 'NOT the release code'}, ${source.metadata}`);
  if (source.codeHash !== wasmHash) throw new Error('the guarded source is not the release code');

  const paused = async () => (await query(vest, 'isCreationPaused'))[0] === '01';
  await vote(
    safe,
    (ctx) => buildProposeCall(ctx, { to: vest, functionName: 'pauseCreation' }),
    { name: 'SendAsyncCall', to: vest, data: 'pauseCreation' },
    [dave, alice, dave],
    'pauseCreation, proposed and carried out by the guarded wallet',
    keys
  );
  console.log(`  isCreationPaused = ${await paused()}`);
  if (!(await paused())) throw new Error('pauseCreation did not pause');
  await vote(
    safe,
    (ctx) => buildProposeCall(ctx, { to: vest, functionName: 'unpauseCreation' }),
    { name: 'SendAsyncCall', to: vest, data: 'unpauseCreation' },
    [alice, dave, dave],
    'unpauseCreation, signed and carried out by the guarded wallet',
    keys
  );
  console.log(`  isCreationPaused = ${await paused()}`);
  if (await paused()) throw new Error('unpauseCreation did not unpause');

  await vote(
    safe,
    (ctx) => buildProposeUpgrade(ctx, { target: vest, source: state.guardedSource, metadata: metadataFromHex('0500') }),
    { name: 'SCUpgradeFromSource', source: state.guardedSource },
    [dave, alice, dave],
    'upgrade from the guarded source, proposed and carried out by the guarded wallet',
    keys
  );
  const after = await facts(vest);
  console.log(`  after: code ${after.codeHash === wasmHash ? 'the release code' : after.codeHash}, metadata ${after.metadata}`);
  if (after.codeHash !== wasmHash || after.metadata !== '0500') throw new Error('the contract is not as it should be');

  // A proposal the guarded wallet takes back: unsign, then discard.
  const proposed = await send(
    await buildProposeCall(await context(dave, safe), { to: vest, functionName: 'setFee', args: [{ kind: 'egld', value: '0.01' }] }),
    dave,
    'dave proposes setFee 0.01 EGLD, to take it back',
    { guardianKey: guardian }
  );
  let id;
  for (let attempt = 0; id === undefined; attempt++) {
    try {
      id = actionIdFrom(attempt ? await getJson(`/transactions/${proposed.txHash}?withScResults=true&withLogs=true`) : proposed);
    } catch (error) {
      if (attempt >= 12) throw error;
      await sleep(2500);
    }
  }
  await send(await buildUnsign(await context(dave, safe), id), dave, `dave takes his signature back (#${id})`, { guardianKey: guardian });
  await send(await buildDiscard(await context(dave, safe), id), dave, `dave discards it (#${id})`, { guardianKey: guardian });
  console.log('\nGUARDED STEPS PASSED');
};

run().catch((error) => {
  console.error('\nFAILED:', error.message);
  process.exit(1);
});
