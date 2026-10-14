// UPG-01 devnet proof (carol only, devnet, no value at risk).
//
// The question this settles: when a safe carries out a SendAsyncCall whose
// endpoint is the built-in `upgradeContract` (code + metadata inline), does the
// network actually REPLACE the owned contract's code/metadata, the way the
// multisig endpoint proposeSCUpgradeFromSource would? If yes, then mvxsafe's
// card showing "Call upgradeContract(0x..., 1,280) on erd1..." with the checks
// green ("it works", "the safe owns the contract it calls") hides a real code
// replacement from the board -> critical. If no, the call is merely a doomed
// proposal and the finding is "signer misled by an unreadable call" -> high.
//
// It uses the SHIPPED builders and gas (src/multisig/legacyCalls.js, gas.js),
// exactly like scripts/devnet/upgrade.mjs, so what it shows is what the app does.
//
// Layout, all in carol's shard (0), so the async call is same-shard, the case
// most likely to succeed:
//   S = a multisig safe, board [carol], quorum 1, deployed by carol
//   T = an upgradeable contract (the same multisig bytecode), deployed by carol,
//       then handed to S. T starts payable (metadata 0506).
//   S votes an async call to T: upgradeContract@<same code>@0500 (payable off).
// Only an upgrade changes an account's code metadata, so if T becomes 0500 the
// call really upgraded it.
//
// Exit 1 when the dangerous behaviour reproduces (T's metadata changed), 0 when
// it does not. Never prints or logs any key material.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Account, ApiNetworkProvider } from '@multiversx/sdk-core';
import { settleGas } from '../../../multisig/gas.js';
import {
  buildDeploySafe,
  buildPerform,
  buildProposeCall,
  buildSign,
  metadataToHex,
  predictSafeAddress,
  shardOf
} from '../../../multisig/legacyCalls.js';

const API = 'https://devnet-api.multiversx.com';
const CHAIN = 'D';
const api = new ApiNetworkProvider(API, { clientName: 'mvxsafe-audit-UPG-01' });
const KEYS = `${homedir()}/.mvxsafe-devnet`;
const WASM = new Uint8Array(
  readFileSync(new URL('../../../../public/contracts/multisig.wasm', import.meta.url))
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const carol = Account.newFromMnemonic(
  readFileSync(`${KEYS}/carol.mnemonic`, 'utf8').trim()
);
const CAROL = carol.address.toBech32();

const nonceOf = async (address) => Number((await api.getAccount(address)).nonce);

const sendAndWait = async (transaction, label, { budget } = {}) => {
  transaction.nonce = BigInt(await nonceOf(carol.address));
  await settleGas(transaction, { provider: api, budget });
  transaction.signature = await carol.signTransaction(transaction);
  const hash = await api.sendTransaction(transaction);
  let onNetwork;
  for (let at = 0; at < 120; at++) {
    await sleep(2500);
    try {
      const raw = await (await fetch(
        `${API}/transactions/${hash}?withScResults=true&withLogs=true`
      )).json();
      if (raw.status === 'pending' || raw.pendingResults) continue;
      onNetwork = raw;
      break;
    } catch {
      /* not indexed yet */
    }
  }
  const events = (onNetwork?.logs?.events ?? []).map((e) => e.identifier);
  for (const r of onNetwork?.results ?? [])
    for (const e of r.logs?.events ?? []) events.push(e.identifier);
  const failedInside = events.some((n) => /signalError|internalVMErrors/.test(n));
  const ok = onNetwork?.status === 'success' && !failedInside;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${label}  ${hash}  gas ${Number(transaction.gasLimit).toLocaleString('en-US')}`
  );
  return { ok, onNetwork, events };
};

const facts = async (address) => {
  const a = await (await fetch(`${API}/accounts/${address}`)).json();
  return {
    owner: a.ownerAddress,
    codeHash: a.codeHash,
    metadata: a.codeHash
      ? metadataToHex({
          upgradeable: a.isUpgradeable,
          readable: a.isReadable,
          payable: a.isPayable,
          payableBySc: a.isPayableBySmartContract
        })
      : null
  };
};

const actionIdFrom = (onNetwork) => {
  for (const r of onNetwork.results ?? []) {
    const data = r.data ? Buffer.from(r.data, 'base64').toString() : '';
    const parts = data.split('@').filter(Boolean);
    if (parts[0] === '6f6b' && parts[1]) return parseInt(parts[1], 16);
  }
  for (const e of onNetwork.logs?.events ?? []) {
    if (e.identifier !== 'writeLog') continue;
    const data = e.data ? Buffer.from(e.data, 'base64').toString() : '';
    const parts = data.split('@').filter(Boolean);
    if (parts[0] === '6f6b' && parts[1]) return parseInt(parts[1], 16);
  }
  throw new Error('no action id');
};

const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const run = async () => {
  console.log(`carol ${CAROL} shard ${shardOf(CAROL)}`);

  const deployNonce = await nonceOf(carol.address);
  const SAFE = predictSafeAddress(CAROL, deployNonce);
  const deployS = await buildDeploySafe(
    { chainId: CHAIN, sender: CAROL, nonce: deployNonce },
    { bytecode: WASM, quorum: 1, board: [CAROL] }
  );
  const rS = await sendAndWait(deployS, 'deploy safe S');
  if (!rS.ok) throw new Error('safe deploy failed');

  const targetNonce = await nonceOf(carol.address);
  const TARGET = predictSafeAddress(CAROL, targetNonce);
  const deployT = await buildDeploySafe(
    { chainId: CHAIN, sender: CAROL, nonce: targetNonce },
    { bytecode: WASM, quorum: 1, board: [CAROL] }
  );
  const rT = await sendAndWait(deployT, 'deploy target T');
  if (!rT.ok) throw new Error('target deploy failed');

  console.log(`  S = ${SAFE} (shard ${shardOf(SAFE)})`);
  console.log(`  T = ${TARGET} (shard ${shardOf(TARGET)})`);

  // Hand T to S, so S owns it and may upgrade it. buildHandOver hands a contract
  // to itself; here T must go to S, so build ChangeOwnerAddress(S) on T directly.
  const { Address, SmartContractTransactionsFactory, TransactionsFactoryConfig, AddressValue } =
    await import('@multiversx/sdk-core');
  const factory = new SmartContractTransactionsFactory({
    config: new TransactionsFactoryConfig({ chainID: CHAIN })
  });
  const giveT = await factory.createTransactionForExecute(new Address(CAROL), {
    contract: new Address(TARGET),
    function: 'ChangeOwnerAddress',
    gasLimit: 0n,
    arguments: [new AddressValue(new Address(SAFE))]
  });
  const rHand = await sendAndWait(giveT, 'hand T over to S');
  if (!rHand.ok) throw new Error('handover failed');

  const before = await facts(TARGET);
  console.log(`  T before: owner ${before.owner} metadata ${before.metadata} codeHash ${before.codeHash}`);
  if (before.owner !== SAFE) throw new Error('S does not own T after handover');

  // S votes a call to T: the built-in upgradeContract, same code, metadata 0500
  // (payable off). This is exactly the action mvxsafe would show as
  // "Call upgradeContract(0x..., 1,280) on <T>" with green checks.
  const newMetadata = '0500';
  const propose = await buildProposeCall(
    { chainId: CHAIN, sender: CAROL, nonce: await nonceOf(carol.address), safe: SAFE },
    {
      to: TARGET,
      functionName: 'upgradeContract',
      args: [
        { kind: 'hex', value: hex(WASM) },
        { kind: 'hex', value: newMetadata }
      ]
    }
  );
  const rProp = await sendAndWait(propose, 'propose upgradeContract call on S');
  if (!rProp.ok) throw new Error('propose failed');
  let id;
  for (let attempt = 0; id === undefined; attempt++) {
    try {
      id = actionIdFrom(
        attempt
          ? await (await fetch(
              `${API}/transactions/${rProp.onNetwork.txHash}?withScResults=true&withLogs=true`
            )).json()
          : rProp.onNetwork
      );
    } catch (e) {
      if (attempt >= 12) throw e;
      await sleep(2500);
    }
  }
  console.log(`  action #${id}`);

  const sign = await buildSign(
    { chainId: CHAIN, sender: CAROL, nonce: await nonceOf(carol.address), safe: SAFE },
    id
  );
  const rSign = await sendAndWait(sign, `sign #${id}`);
  if (!rSign.ok) throw new Error('sign failed');

  const perform = await buildPerform(
    { chainId: CHAIN, sender: CAROL, nonce: await nonceOf(carol.address), safe: SAFE },
    id
  );
  // A generous budget; this proof is about whether it EXECUTES, not the app's
  // gas rule. Well under the 600M ceiling.
  const rPerf = await sendAndWait(perform, `carry out #${id}`, { budget: 200000000n });

  await sleep(6000);
  const after = await facts(TARGET);
  console.log(`  T after:  owner ${after.owner} metadata ${after.metadata} codeHash ${after.codeHash}`);

  const changed = before.metadata !== after.metadata;
  console.log('');
  if (changed) {
    console.log(
      `DANGER REPRODUCED: an action mvxsafe shows as "Call upgradeContract(...) on ${TARGET}" ` +
        `rewrote the contract's code metadata ${before.metadata} -> ${after.metadata}. ` +
        `The card hid a real upgrade. UPG-01 is critical.`
    );
    process.exit(1);
  }
  console.log(
    `The upgradeContract call did not change T (perform ok=${rPerf.ok}). ` +
      `Metadata stayed ${after.metadata}. The async built-in did not upgrade; ` +
      `UPG-01 remains a display/inspect finding (a doomed/unreadable call shown green).`
  );
  process.exit(0);
};

run().catch((error) => {
  console.error(`UPG-01 proof could not complete: ${error.message}`);
  process.exit(2);
});
