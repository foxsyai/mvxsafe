// What the network does with a transaction whose nonce is one ahead of the
// account (the situation TX-08 puts the app in after one failed send).
// bob sends a harmless 0-EGLD note to himself with nonce N+1, we watch it for
// a while, then send nonce N and see whether the first one dies or executes.
//   cd /home/sebastian/FOXSY/mvxsafe/app && node src/__audit__/tx/proofs/TX-08-nonce-gap.mjs
// Exit 0 always: this records protocol behaviour, it is not a regression test.
// Devnet only, bob only, two transactions of 50k-ish gas.
import { Account, ApiNetworkProvider, Transaction } from '@multiversx/sdk-core';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const API = 'https://devnet-api.multiversx.com';
const GATEWAY = 'https://devnet-gateway.multiversx.com';
const api = new ApiNetworkProvider(API, { clientName: 'mvxsafe-audit-tx' });
const bob = Account.newFromMnemonic(readFileSync(`${homedir()}/.mvxsafe-devnet/bob.mnemonic`, 'utf8').trim());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const note = async (nonce, text) => {
  const data = Buffer.from(text);
  const tx = new Transaction({
    nonce: BigInt(nonce),
    value: 0n,
    sender: bob.address,
    receiver: bob.address,
    gasLimit: BigInt(50000 + 1500 * data.length),
    gasPrice: 1000000000n,
    chainID: 'D',
    data,
    version: 2
  });
  tx.signature = await bob.signTransaction(tx);
  return api.sendTransaction(tx);
};

const gatewayStatus = async (hash) => {
  const r = await (await fetch(`${GATEWAY}/transaction/${hash}`)).json();
  return r?.data?.transaction?.status ?? r?.error ?? JSON.stringify(r).slice(0, 80);
};
const apiStatus = async (hash) => {
  const r = await fetch(`${API}/transactions/${hash}`);
  if (r.status === 404) return 'not indexed';
  return (await r.json()).status;
};

const run = async () => {
  const n = Number((await api.getAccount(bob.address)).nonce);
  console.log(`bob ${bob.address.toBech32()} is at nonce ${n}`);
  let ahead;
  try {
    ahead = await note(n + 1, 'mvxsafe audit: nonce gap, sent first with nonce+1');
    console.log(`  sent with nonce ${n + 1}: ${ahead}`);
  } catch (error) {
    console.log(`  the API REFUSED the nonce+1 transaction at submission: ${error.message}`);
    return;
  }
  for (let i = 0; i < 6; i++) {
    await sleep(10000);
    console.log(`  after ${(i + 1) * 10}s: gateway says "${await gatewayStatus(ahead)}", API says "${await apiStatus(ahead)}", account nonce ${Number((await api.getAccount(bob.address)).nonce)}`);
  }
  const fill = await note(n, 'mvxsafe audit: nonce gap, the filler with nonce N');
  console.log(`  now sent the filler with nonce ${n}: ${fill}`);
  for (let i = 0; i < 6; i++) {
    await sleep(10000);
    const nonceNow = Number((await api.getAccount(bob.address)).nonce);
    console.log(`  after ${(i + 1) * 10}s: filler "${await apiStatus(fill)}", the nonce+1 one "${await apiStatus(ahead)}" (gateway "${await gatewayStatus(ahead)}"), account nonce ${nonceNow}`);
    if (nonceNow >= n + 2) break;
  }
  const finalNonce = Number((await api.getAccount(bob.address)).nonce);
  console.log(finalNonce >= n + 2
    ? '\nRESULT: the transaction that waited with a nonce gap EXECUTED once the gap was filled.'
    : `\nRESULT: the nonce+1 transaction did not execute (account nonce ${finalNonce}).`);
};

run().catch((error) => {
  console.error('SCRIPT ERROR:', error.message);
  process.exit(2);
});
