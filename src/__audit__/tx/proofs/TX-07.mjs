// TX-07 devnet evidence: a token transfer the safe cannot pay is accepted as a
// proposal and collects its signatures. What happens at performAction depends
// on the recipient's shard:
//   - same shard as the safe: this build CLEARS THE ACTION BEFORE issuing the
//     async ESDTTransfer; the transfer fails ("insufficient funds"), the tokens
//     stay, the action is gone (getActionData -> Nothing) and the board's
//     signatures are consumed for nothing;
//   - another shard: the perform transaction fails and the action stays
//     pending with its signatures, so it cannot be discarded until everybody
//     unsigns, and "Carry it out" fails again every time it is pressed.
//
//   cd /home/sebastian/FOXSY/mvxsafe/app
//   node src/__audit__/tx/proofs/TX-07.mjs                 same-shard recipient (alice)
//   RECIPIENT=bob node src/__audit__/tx/proofs/TX-07.mjs   cross-shard recipient (bob)
//   DRY=1 ...                                              only read state, send nothing
//   CLEANUP=<id> ...                                       alice and bob unsign, bob discards
//
// Exit 1 when the behaviour reproduces (the action was consumed although
// nothing moved), 0 otherwise. Devnet only, alice and bob only, throwaway keys,
// nothing about them is printed.
import { Account, Address, ApiNetworkProvider, SmartContractController, U32Value } from '@multiversx/sdk-core';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  buildDiscard,
  buildPerform,
  buildProposeToken,
  buildSign,
  buildUnsign,
  legacyAbi
} from '../../../multisig/legacyCalls.js';

const SAFE = readFileSync(new URL('../../../../scripts/devnet/safe.txt', import.meta.url), 'utf8').trim();
const TOKEN = 'WEGLD-a28c59';
const TOO_MUCH = '1000'; // the safe holds about 2.5
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
    const data = typeof result.data === 'string' ? result.data : '';
    const parts = data.split('@').filter(Boolean);
    if (parts[0] === '6f6b' && parts[1]) return parseInt(parts[1], 16);
  }
  for (const event of onNetwork.logs?.events ?? []) {
    const data = event.data instanceof Uint8Array ? Buffer.from(event.data).toString() : '';
    const parts = data.split('@').filter(Boolean);
    if (parts[0] === '6f6b' && parts[1]) return parseInt(parts[1], 16);
  }
  return 0;
};

/** The raw API view of a transaction, which is what the app's tracker (sdk-dapp) reads. */
const rawTx = async (hash) => (await fetch(`${API}/transactions/${hash}`)).json();
const printable = (text) => text.replace(/[^\x20-\x7e]/g, '.');
const describeResults = (tx) => {
  for (const r of tx.results ?? []) {
    const data = Buffer.from(String(r.data ?? ''), 'base64').toString();
    console.log(`    result -> ${String(r.receiver).slice(0, 14)}  data: ${printable(data).slice(0, 100)}${r.returnMessage ? `  returnMessage: ${r.returnMessage}` : ''}`);
  }
  for (const e of tx.logs?.events ?? []) {
    const topics = (e.topics ?? []).map((t) => printable(Buffer.from(t, 'base64').toString()));
    console.log(`    event  ${e.identifier}  topics: ${topics.join(' | ').slice(0, 140)}`);
  }
  for (const op of tx.operations ?? []) {
    console.log(`    operation ${op.action ?? ''} ${op.type ?? ''} ${op.identifier ?? ''} -> ${String(op.receiver ?? '').slice(0, 14)}  ${op.message ?? ''}`);
  }
};

const isPending = async (id) => {
  const pending = await view('getPendingActionFullInfo');
  return (Array.isArray(pending) ? pending : pending ? [pending] : []).some((p) => num(p.action_id) === id);
};

const cleanup = async (alice, bob, id) => {
  console.log(`\n--- cleanup of action ${id}: everybody unsigns, then it can be discarded ---`);
  const signers = (await view('getActionSigners', [new U32Value(id)])) ?? [];
  const who = (Array.isArray(signers) ? signers : [signers]).map((a) => a.toBech32?.() ?? String(a));
  for (const member of [alice, bob]) {
    if (who.includes(member.address.toBech32())) {
      await send(await buildUnsign(await context(member), id), member, `${member === alice ? 'alice' : 'bob'} unsigns ${id}`);
    }
  }
  console.log('  valid signatures now', num(await view('getActionValidSignerCount', [new U32Value(id)])));
  await send(await buildDiscard(await context(bob), id), bob, `bob discards ${id}`);
  console.log(`  action ${id} now: ${(await view('getActionData', [new U32Value(id)]))?.name} | still pending: ${await isPending(id)}`);
};

const run = async () => {
  const alice = load('alice');
  const bob = load('bob');
  console.log('safe ', SAFE);
  console.log('alice', alice.address.toBech32(), '(shard 1, like the safe) | bob', bob.address.toBech32(), '(shard 2)');

  if (process.env.CLEANUP) {
    await cleanup(alice, bob, Number(process.env.CLEANUP));
    return false;
  }

  const recipient = process.env.RECIPIENT === 'bob' ? bob : alice;
  const where = recipient === bob ? 'bob, another shard' : 'alice, same shard as the safe';
  const safeBefore = await tokenAmount(new Address(SAFE));
  console.log(`safe holds ${fmt(safeBefore)} ${TOKEN}; proposing ${TOO_MUCH} to ${where}`);
  console.log('quorum', num(await view('getQuorum')), '| last action index', num(await view('getActionLastIndex')));

  if (process.env.DRY) {
    const tx = await buildProposeToken(await context(alice), { to: recipient.address.toBech32(), tokenIdentifier: TOKEN, amount: TOO_MUCH, decimals: 18 });
    console.log('DRY: would send', Buffer.from(tx.data).toString());
    return false;
  }

  const recipientBefore = await tokenAmount(recipient.address);
  const proposed = await send(
    await buildProposeToken(await context(alice), { to: recipient.address.toBech32(), tokenIdentifier: TOKEN, amount: TOO_MUCH, decimals: 18 }),
    alice,
    `alice proposes ${TOO_MUCH} ${TOKEN} (safe has ${fmt(safeBefore)})`
  );
  const id = actionIdFrom(proposed.onNetwork);
  console.log('  action id', id, '| data', (await view('getActionData', [new U32Value(id)]))?.name, '| signers', num(await view('getActionSignerCount', [new U32Value(id)])));

  await send(await buildSign(await context(bob), id), bob, `bob signs action ${id}`);
  console.log('  signers', num(await view('getActionSignerCount', [new U32Value(id)])), '| quorumReached', String(await view('quorumReached', [new U32Value(id)])));

  const performed = await send(await buildPerform(await context(bob), id), bob, `bob carries out action ${id}`);
  await sleep(20000); // let the results settle before reading the API view
  const raw = await rawTx(performed.hash);
  console.log(`  API view: status=${raw.status} pendingResults=${raw.pendingResults ?? false}`);
  describeResults(raw);

  const after = await view('getActionData', [new U32Value(id)]);
  const stillPending = await isPending(id);
  const safeAfter = await tokenAmount(new Address(SAFE));
  const recipientAfter = await tokenAmount(recipient.address);
  console.log(`  action ${id} now: ${after?.name} | still pending: ${stillPending}`);
  console.log(`  safe ${fmt(safeBefore)} -> ${fmt(safeAfter)} | recipient ${fmt(recipientBefore)} -> ${fmt(recipientAfter)}`);

  const moved = recipientAfter !== recipientBefore || safeAfter !== safeBefore;
  const consumed = after?.name === 'Nothing' && !stillPending;
  console.log(`  => tokens moved: ${moved} | action consumed: ${consumed} | network says: ${raw.status}`);
  if (!moved && !consumed) {
    console.log(`  the action is stuck pending with ${num(await view('getActionValidSignerCount', [new U32Value(id)]))} valid signatures; run CLEANUP=${id} to remove it`);
  }
  return !moved && consumed;
};

run()
  .then((reproduced) => {
    console.log(reproduced ? '\nREPRODUCED: the board\'s signatures were consumed and nothing moved.' : '\nnot reproduced');
    process.exit(reproduced ? 1 : 0);
  })
  .catch((error) => {
    console.error('\nSCRIPT ERROR:', error.message);
    process.exit(2);
  });
