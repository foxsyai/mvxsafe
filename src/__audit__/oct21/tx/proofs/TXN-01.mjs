// TXN-01 on devnet, from the guarded wallet dave: the app predicts a new
// contract's address from the nonce the API reports, while the wallet (driven
// by sdk-dapp) signs with its own latest nonce, which is one ahead for as long
// as a transaction sent moments ago is still in the pool. The deploy then
// lands at a different address, owned by the wallet, and the handover the app
// built for the predicted address fails.
//
//   (from the repository root)
//   node src/__audit__/oct21/tx/proofs/TXN-01.mjs            measure the window:
//        one guarded 0-EGLD transfer to self, then how long the API keeps
//        reporting the old nonce. Always exits 0.
//   ORPHAN=1 node src/__audit__/oct21/tx/proofs/TXN-01.mjs   the consequence:
//        a filler at N (the "transaction sent moments ago"), the deploy of a
//        1-of-1 safe signed at N+1 as sdk-dapp signs it, and the handover for
//        the address the app predicted from N, at N+2. Exit 1 while the safe
//        lands at the N+1 address, still owned by the wallet, and the handover
//        to the predicted address fails; 0 otherwise.
//
// That sdk-dapp signs at N+1 while the app predicts from N is proven against
// the real sdk-dapp in TXN-01.test.ts; here the nonce bump is applied by hand
// (the .mjs does not run sdk-dapp) to show the chain consequence a unit test
// cannot. Gas is a fixed, generous figure, so no cost simulation can race the
// filler. Devnet only, dave and the guardian key; nothing about them printed.
import {
  Account,
  Address,
  ApiNetworkProvider,
  Transaction,
  TransactionComputer
} from '@multiversx/sdk-core';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  buildDeploySafe,
  buildHandOver,
  MULTISIG_CODE_HASH,
  predictSafeAddress
} from '../../../../multisig/legacyCalls.js';

const API = 'https://devnet-api.multiversx.com';
const GATEWAY = 'https://devnet-gateway.multiversx.com';
const CHAIN = 'D';
const api = new ApiNetworkProvider(API, { clientName: 'mvxsafe-audit-txn' });
const computer = new TransactionComputer();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const load = (name) =>
  Account.newFromMnemonic(
    readFileSync(`${homedir()}/.mvxsafe-devnet/${name}.mnemonic`, 'utf8').trim()
  );

const getJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
};
const apiNonce = async (address) =>
  Number((await getJson(`${API}/accounts/${address}`)).nonce);
const gatewayNonce = async (address) =>
  Number((await getJson(`${GATEWAY}/address/${address}`)).data.account.nonce);
const guardianOf = async (address) => {
  const account = await getJson(
    `${API}/accounts/${address}?withGuardianInfo=true`
  );
  return account.isGuarded ? account.activeGuardianAddress : '';
};

/**
 * Applies the guardian (as settleGas does), sets a fixed gas and the given
 * nonce, then signs with the wallet and co-signs with the guardian. No cost
 * simulation, so nothing can race the filler. Returns the hash.
 */
const sendGuarded = async (
  transaction,
  signer,
  guardianKey,
  nonce,
  gasLimit
) => {
  const guardian = await guardianOf(signer.address.toBech32());
  if (!guardian) throw new Error('this proof expects the guarded wallet dave');
  if (guardianKey.address.toBech32() !== guardian)
    throw new Error('the guardian key does not match the active guardian');
  computer.applyGuardian(transaction, Address.newFromBech32(guardian));
  transaction.gasLimit = BigInt(gasLimit);
  transaction.nonce = BigInt(nonce);
  transaction.signature = await signer.signTransaction(transaction);
  transaction.guardianSignature =
    await guardianKey.signTransaction(transaction);
  return api.sendTransaction(transaction);
};

const waitFor = async (hash, label) => {
  for (let at = 0; at < 80; at++) {
    await sleep(3000);
    try {
      const raw = await getJson(
        `${API}/transactions/${hash}?withScResults=true&withLogs=true`
      );
      if (raw.status === 'pending' || raw.pendingResults) continue;
      const events = [
        ...(raw.logs?.events ?? []),
        ...(raw.results ?? []).flatMap((r) => r.logs?.events ?? [])
      ];
      const errors = events
        .filter((event) =>
          /signalError|internalVMErrors/.test(event.identifier)
        )
        .map((event) =>
          (event.topics ?? [])
            .map((t) => Buffer.from(t, 'base64').toString())
            .filter(Boolean)
            .join(' | ')
        );
      console.log(
        `  ${String(raw.status).padEnd(8)} ${label}  ${hash}${errors.length ? `\n           ${errors.join('\n           ')}` : ''}`
      );
      return raw;
    } catch {
      // not indexed yet
    }
  }
  console.log(`  no answer ${label}  ${hash}`);
  return null;
};

const selfTransfer = (account, nonce) =>
  new Transaction({
    sender: account.address,
    receiver: account.address,
    value: 0n,
    gasLimit: 0n,
    chainID: CHAIN,
    nonce: BigInt(nonce),
    data: new TextEncoder().encode('mvxsafe audit TXN-01')
  });

const measureWindow = async (dave, guardian) => {
  const who = dave.address.toBech32();
  const before = await apiNonce(who);
  console.log(
    `guarded wallet at nonce ${before} (API), ${await gatewayNonce(who)} (gateway)`
  );
  const started = Date.now();
  const hash = await sendGuarded(
    selfTransfer(dave, before),
    dave,
    guardian,
    before,
    100000
  );
  console.log(
    `  sent a guarded 0-EGLD self-transfer at nonce ${before}: ${hash}`
  );
  let apiAt = null;
  let gatewayAt = null;
  let statusAt = null;
  const elapsed = () => ((Date.now() - started) / 1000).toFixed(1);
  while (
    Date.now() - started < 90000 &&
    (apiAt === null || gatewayAt === null || statusAt === null)
  ) {
    await sleep(250);
    if (apiAt === null) {
      try {
        if ((await apiNonce(who)) > before) apiAt = elapsed();
      } catch {}
    }
    if (gatewayAt === null) {
      try {
        if ((await gatewayNonce(who)) > before) gatewayAt = elapsed();
      } catch {}
    }
    if (statusAt === null) {
      try {
        const raw = await getJson(`${API}/transactions/${hash}`);
        if (raw.status && raw.status !== 'pending')
          statusAt = `${elapsed()} (${raw.status})`;
      } catch {}
    }
  }
  console.log(
    `  the gateway reported nonce ${before + 1} after ${gatewayAt ?? '>90'} s`
  );
  console.log(
    `  the API reported nonce ${before + 1} after ${apiAt ?? '>90'} s`
  );
  console.log(`  the transaction left "pending" after ${statusAt ?? '>90 s'}`);
  console.log(
    `\nWINDOW: for about ${apiAt ?? '>90'} s after a send, the app reads the old nonce ${before} and predicts an address from it, while sdk-dapp signs with ${before + 1}.`
  );
  return 0;
};

const facts = async (address) => {
  try {
    const account = await getJson(`${API}/accounts/${address}`);
    return {
      code: account.codeHash ?? null,
      owner: account.ownerAddress ?? null
    };
  } catch {
    return { code: null, owner: null };
  }
};

const orphan = async (dave, guardian) => {
  const who = dave.address.toBech32();
  const nonce = await apiNonce(who);
  const predicted = predictSafeAddress(who, nonce);
  const actual = predictSafeAddress(who, nonce + 1);
  console.log(`guarded wallet at nonce ${nonce}`);
  console.log(`  the app predicts, saves and navigates to ${predicted}`);
  console.log(
    `  a deploy signed at nonce ${nonce + 1} instead creates   ${actual}`
  );
  const bytecode = new Uint8Array(
    readFileSync(
      new URL('../../../../../public/contracts/multisig.wasm', import.meta.url)
    )
  );

  // The deploy and the handover exactly as createSafe builds them from the
  // nonce the API reported (predicted address).
  const deploy = await buildDeploySafe(
    { chainId: CHAIN, sender: who, nonce },
    { bytecode, quorum: 1, board: [who] }
  );
  const handOver = await buildHandOver({
    chainId: CHAIN,
    sender: who,
    nonce: nonce + 1,
    safe: predicted
  });

  // A transaction sent moments ago, still in the pool when the wallet signs...
  const fillerHash = await sendGuarded(
    selfTransfer(dave, nonce),
    dave,
    guardian,
    nonce,
    500000
  );
  console.log(`  sent the filler at nonce ${nonce}: ${fillerHash}`);
  // ...so sdk-dapp raises both nonces by one before the wallet signs.
  const deployHash = await sendGuarded(
    deploy,
    dave,
    guardian,
    nonce + 1,
    120000000
  );
  console.log(`  sent the deploy at nonce ${nonce + 1}: ${deployHash}`);
  const handOverHash = await sendGuarded(
    handOver,
    dave,
    guardian,
    nonce + 2,
    6300000
  );
  console.log(
    `  sent the handover for the predicted address at nonce ${nonce + 2}: ${handOverHash}`
  );

  await waitFor(fillerHash, 'filler');
  await waitFor(deployHash, 'deploy');
  const handOverOnChain = await waitFor(
    handOverHash,
    'handover to the predicted address'
  );
  await sleep(6000);

  const atPredicted = await facts(predicted);
  const atActual = await facts(actual);
  console.log(
    `\n  ${predicted} (saved by the app): code ${atPredicted.code ?? 'none'}`
  );
  console.log(
    `  ${actual} (actually created): code ${atActual.code === MULTISIG_CODE_HASH ? 'the multisig' : (atActual.code ?? 'none')}, owner ${atActual.owner === actual ? 'itself' : atActual.owner === who ? 'the deployer wallet' : atActual.owner}`
  );
  const reproduced =
    atPredicted.code === null &&
    atActual.code === MULTISIG_CODE_HASH &&
    atActual.owner === who &&
    handOverOnChain?.status !== 'success';
  console.log(
    reproduced
      ? `\nREPRODUCED: the safe exists at ${actual}, an address the app never showed, still owned by the deployer wallet; the handover to the predicted address ${handOverOnChain?.status ?? 'gave no answer'}.`
      : '\nNOT REPRODUCED.'
  );
  return reproduced ? 1 : 0;
};

const run = async () => {
  const dave = load('dave');
  const guardian = load('guardian');
  const code = process.env.ORPHAN
    ? await orphan(dave, guardian)
    : await measureWindow(dave, guardian);
  process.exit(code);
};

run().catch((error) => {
  console.error('\nFAILED:', error.message);
  process.exit(2);
});
