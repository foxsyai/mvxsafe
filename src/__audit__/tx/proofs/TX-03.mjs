// TX-03 devnet proof: the token builder turns a negative amount into a
// well-formed proposal for ZERO tokens, and the contract accepts it.
//
//   node src/__audit__/tx/proofs/TX-03.mjs
//   AMOUNT=-0.5 ...     another negative amount (default -1)
//
// Exit 1 when the bug reproduces: buildProposeToken produces a transaction and
// the chain registers an action for it. Exit 0 once the builder refuses the
// amount (the fix) so nothing is sent. After the proposal is accepted the
// script also signs and performs it, to record what happens to a transfer of
// nothing (same-shard recipient, so a failed perform consumes the action and
// leaves nothing to clean up). Devnet only, alice and bob only, throwaway keys.
import { Account, Address, ApiNetworkProvider, SmartContractController, U32Value } from '@multiversx/sdk-core';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { buildPerform, buildProposeToken, buildSign, legacyAbi } from '../../../multisig/legacyCalls.js';

const SAFE = readFileSync(new URL('../../../../scripts/devnet/safe.txt', import.meta.url), 'utf8').trim();
const TOKEN = 'WEGLD-a28c59';
const AMOUNT = process.env.AMOUNT ?? '-1';
const API = 'https://devnet-api.multiversx.com';
const api = new ApiNetworkProvider(API, { clientName: 'mvxsafe-audit-tx' });
const contracts = new SmartContractController({ chainID: 'D', networkProvider: api, abi: legacyAbi });

const load = (name) =>
  Account.newFromMnemonic(readFileSync(`${homedir()}/.mvxsafe-devnet/${name}.mnemonic`, 'utf8').trim());
const nonceOf = async (who) => Number((await api.getAccount(who.address)).nonce);
const context = async (signer) => ({ chainId: 'D', sender: signer.address.toBech32(), nonce: await nonceOf(signer), safe: SAFE });
const view = async (fn, args = []) =>
  (await contracts.query({ contract: new Address(SAFE), function: fn, arguments: args }))[0];
const num = (v) => Number(v?.toString?.() ?? v ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tokenAmount = async (address) => {
  const found = (await api.getFungibleTokensOfAccount(address)).find((t) => t.token.identifier === TOKEN);
  return found ? found.amount : 0n;
};
const fmt = (raw) => (Number(raw) / 1e18).toFixed(4);

const send = async (transaction, signer, label) => {
  transaction.nonce = BigInt(await nonceOf(signer));
  transaction.signature = await signer.signTransaction(transaction);
  const hash = await api.sendTransaction(transaction);
  const deadline = Date.now() + 300000;
  let onNetwork;
  while (Date.now() < deadline) {
    await sleep(4000);
    try {
      onNetwork = await api.getTransaction(hash);
      if (onNetwork.status.isSuccessful() || onNetwork.status.isFailed()) break;
    } catch {
      // not indexed yet
    }
  }
  console.log(`  ${String(onNetwork?.status ?? '?').padEnd(8)} ${label}  ${hash}`);
  return { hash, onNetwork };
};

const actionIdFrom = (onNetwork) => {
  for (const result of onNetwork.smartContractResults ?? []) {
    const parts = (typeof result.data === 'string' ? result.data : '').split('@').filter(Boolean);
    if (parts[0] === '6f6b' && parts[1]) return parseInt(parts[1], 16);
  }
  for (const event of onNetwork.logs?.events ?? []) {
    const data = event.data instanceof Uint8Array ? Buffer.from(event.data).toString() : '';
    const parts = data.split('@').filter(Boolean);
    if (parts[0] === '6f6b' && parts[1]) return parseInt(parts[1], 16);
  }
  return 0;
};

const printable = (text) => text.replace(/[^\x20-\x7e]/g, '.');
const describe = async (hash) => {
  const tx = await (await fetch(`${API}/transactions/${hash}`)).json();
  console.log(`  API view: status=${tx.status}`);
  for (const r of tx.results ?? []) {
    console.log(`    result -> ${String(r.receiver).slice(0, 14)}  data: ${printable(Buffer.from(String(r.data ?? ''), 'base64').toString()).slice(0, 100)}${r.returnMessage ? `  returnMessage: ${r.returnMessage}` : ''}`);
  }
  for (const e of tx.logs?.events ?? []) {
    const topics = (e.topics ?? []).map((t) => printable(Buffer.from(t, 'base64').toString()));
    console.log(`    event  ${e.identifier}  topics: ${topics.join(' | ').slice(0, 140)}`);
  }
};

const run = async () => {
  const alice = load('alice');
  const bob = load('bob');
  console.log('safe ', SAFE);
  console.log(`alice ${alice.address.toBech32()} proposes ${JSON.stringify(AMOUNT)} ${TOKEN} to herself (same shard as the safe)`);

  let transaction;
  try {
    transaction = await buildProposeToken(await context(alice), { to: alice.address.toBech32(), tokenIdentifier: TOKEN, amount: AMOUNT, decimals: 18 });
  } catch (error) {
    console.log(`  the builder refused it: ${error.message}`);
    return false;
  }
  const data = Buffer.from(transaction.data).toString();
  console.log('  the builder produced:', data);
  const amountArgument = data.split('@')[5];
  console.log(`  amount argument: ${JSON.stringify(amountArgument)} (${amountArgument === '' ? 'EMPTY, which is zero' : amountArgument})`);

  const safeBefore = await tokenAmount(new Address(SAFE));
  const proposed = await send(transaction, alice, `alice proposes ${AMOUNT} ${TOKEN}`);
  const id = actionIdFrom(proposed.onNetwork);
  const registered = id > 0 && (await view('getActionData', [new U32Value(id)]))?.name === 'SendAsyncCall';
  console.log(`  action id ${id} | registered as SendAsyncCall: ${registered} | signers ${num(await view('getActionSignerCount', [new U32Value(id)]))}`);
  if (!registered) return false;

  await send(await buildSign(await context(bob), id), bob, `bob signs action ${id}`);
  const performed = await send(await buildPerform(await context(bob), id), bob, `bob carries out action ${id}`);
  await sleep(20000);
  await describe(performed.hash);
  const after = await view('getActionData', [new U32Value(id)]);
  const pending = await view('getPendingActionFullInfo');
  const stillPending = (Array.isArray(pending) ? pending : pending ? [pending] : []).some((p) => num(p.action_id) === id);
  console.log(`  action ${id} now: ${after?.name} | still pending: ${stillPending} | safe ${fmt(safeBefore)} -> ${fmt(await tokenAmount(new Address(SAFE)))} ${TOKEN}`);
  return true;
};

run()
  .then((reproduced) => {
    console.log(reproduced ? '\nREPRODUCED: a negative amount became an accepted proposal for zero tokens.' : '\nnot reproduced');
    process.exit(reproduced ? 1 : 0);
  })
  .catch((error) => {
    console.error('\nSCRIPT ERROR:', error.message);
    process.exit(2);
  });
