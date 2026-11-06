// What the devnet rehearsals share: throwaway keys, sending a transaction the
// way the app does (nonce from the network, gas settled last), waiting for
// every result, views, and a safe's propose, sign and carry out. Devnet only.
import { Account, ApiNetworkProvider } from '@multiversx/sdk-core';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { settleGas } from '../../src/multisig/gas.js';
import { buildPerform, buildSign } from '../../src/multisig/legacyCalls.js';

export const API = 'https://devnet-api.multiversx.com';
export const CHAIN = 'D';
export const api = new ApiNetworkProvider(API, { clientName: 'mvxsafe-devnet-test' });

const KEYS = `${homedir()}/.mvxsafe-devnet`;
/** A throwaway devnet key by name. Its secret is never printed. */
export const load = (name) => Account.newFromMnemonic(readFileSync(`${KEYS}/${name}.mnemonic`, 'utf8').trim());
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const getJson = async (path) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${API}${path}`);
    if (response.ok) return response.json();
    if (response.status === 404) return null;
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`${path} kept failing`);
};

/** A view, its answers as hex. */
export const query = async (contract, fn, args = []) => {
  const response = await fetch(`${API}/vm-values/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scAddress: contract, funcName: fn, args })
  }).then((r) => r.json());
  const data = response?.data?.data ?? response?.data;
  if (data?.returnCode && data.returnCode !== 'ok') throw new Error(`${fn}: ${data.returnMessage}`);
  return (data?.returnData ?? []).map((item) => Buffer.from(item ?? '', 'base64').toString('hex'));
};
export const big = (hex) => BigInt(`0x${hex || '0'}`);
export const text = (hex) => Buffer.from(hex ?? '', 'hex').toString();

/**
 * Sends one transaction, as the app does, and waits for all its results.
 * `expectFailure` turns a failure into the expected outcome. Every hash goes
 * into `log`.
 */
export const send = async (transaction, signer, label, { budget, log, expectFailure = false } = {}) => {
  const sender = signer.address.toBech32();
  const account = await getJson(`/accounts/${sender}?withGuardianInfo=true`);
  if (account.isGuarded) throw new Error(`${sender} is guarded; this rehearsal does not co-sign`);
  transaction.nonce = BigInt(account.nonce);
  if (transaction.gasLimit === 0n || budget) await settleGas(transaction, { provider: api, guardian: '', budget });
  transaction.signature = await signer.signTransaction(transaction);
  const hash = await api.sendTransaction(transaction);
  let onNetwork;
  for (let at = 0; at < 240; at++) {
    await sleep(2500);
    const raw = await getJson(`/transactions/${hash}?withScResults=true&withLogs=true`).catch(() => null);
    if (!raw || raw.status === 'pending' || raw.pendingResults) continue;
    onNetwork = raw;
    break;
  }
  const events = [...(onNetwork?.logs?.events ?? []), ...(onNetwork?.results ?? []).flatMap((r) => r.logs?.events ?? [])];
  const names = events.map((event) => event.identifier);
  const ok = onNetwork?.status === 'success' && !names.some((name) => /signalError|internalVMErrors/.test(name));
  const mark = ok ? '  ok  ' : expectFailure ? ' fail (expected)' : ' FAIL ';
  console.log(`${mark} ${label}  ${hash}  gas ${Number(transaction.gasLimit).toLocaleString('en-US')}`);
  log?.push({ label, hash, gasLimit: transaction.gasLimit.toString(), ok });
  if (!ok && !expectFailure)
    throw new Error(`${label} did not succeed (${onNetwork?.status ?? 'no answer'}; events: ${names.join(', ')}): ${hash}`);
  if (ok && expectFailure) throw new Error(`${label} succeeded where it should have failed: ${hash}`);
  return { onNetwork, ok, events };
};

/** The action id a propose created, from the contract's answer "@6f6b@<id>". */
export const actionIdFrom = (onNetwork) => {
  const answers = [
    ...(onNetwork.results ?? []).map((result) => result.data),
    ...(onNetwork.logs?.events ?? []).filter((event) => event.identifier === 'writeLog').map((event) => event.data)
  ];
  for (const data of answers) {
    const parts = (data ? Buffer.from(data, 'base64').toString() : '').split('@').filter(Boolean);
    if (parts[0] === '6f6b' && parts[1]) return parseInt(parts[1], 16);
  }
  return undefined;
};

export const contextOf = async (signer, safe) => ({
  chainId: CHAIN,
  sender: signer.address.toBech32(),
  nonce: Number((await api.getAccount(signer.address)).nonce),
  safe
});

/** Proposes; returns the action id (the API can say "success" before it has the answer). */
export const propose = async (safe, build, proposer, label, log) => {
  const { onNetwork } = await send(await build(await contextOf(proposer, safe)), proposer, `propose ${label}`, { log });
  for (let attempt = 0; attempt < 12; attempt++) {
    const id = actionIdFrom(attempt ? await getJson(`/transactions/${onNetwork.txHash}?withScResults=true&withLogs=true`) : onNetwork);
    if (id !== undefined) return id;
    await sleep(2500);
  }
  throw new Error(`no action id in ${onNetwork.txHash}`);
};

export const sign = async (safe, id, signer, label, log) =>
  send(await buildSign(await contextOf(signer, safe), id), signer, `sign ${label} (#${id})`, { log });

export const perform = async (safe, id, performer, label, budget, log, options = {}) =>
  send(await buildPerform(await contextOf(performer, safe), id), performer, `carry out ${label} (#${id})`, {
    budget,
    log,
    ...options
  });
