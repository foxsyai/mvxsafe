// The full multisig cycle on devnet, with throwaway keys, using the SAME
// transaction builders the app ships (src/multisig/legacyCalls.js). Only the
// signer differs: in the app a wallet signs, here a devnet test key does.
//
//   node scripts/devnet/cycle.mjs            reuse the safe from the last run
//   NEW_SAFE=1 node scripts/devnet/cycle.mjs deploy a fresh one
//
// Keys live in ~/.mvxsafe-devnet, devnet only, no value, never in git.
import {
  Account,
  Address,
  ApiNetworkProvider,
  SmartContractController,
  SmartContractTransactionsFactory,
  Token,
  TokenTransfer,
  TransactionsFactoryConfig,
  TransferTransactionsFactory,
  U32Value
} from '@multiversx/sdk-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  buildDiscard,
  buildPerform,
  buildProposeChangeQuorum,
  buildProposeEgld,
  buildProposeRemoveUser,
  buildProposeToken,
  buildSign,
  buildUnsign,
  legacyAbi
} from '../../src/multisig/legacyCalls.js';

const KEYS = `${homedir()}/.mvxsafe-devnet`;
const SAFE_FILE = 'scripts/devnet/safe.txt';
const TOKEN = 'WEGLD-a28c59';
const api = new ApiNetworkProvider('https://devnet-api.multiversx.com', {
  clientName: 'mvxsafe-devnet-test'
});
const contracts = new SmartContractController({
  chainID: 'D',
  networkProvider: api,
  abi: legacyAbi
});
const transfers = new TransferTransactionsFactory({
  config: new TransactionsFactoryConfig({ chainID: 'D' })
});

const load = (name) =>
  Account.newFromMnemonic(readFileSync(`${KEYS}/${name}.mnemonic`, 'utf8').trim());

// Nonces are read from the network before every send: tracking them locally
// drifted as soon as a transaction was still pending from an earlier run.
const nonceOf = async (who) => Number((await api.getAccount(who.address)).nonce);

const send = async (transaction, signer, label) => {
  transaction.nonce = BigInt(await nonceOf(signer));
  transaction.signature = await signer.signTransaction(transaction);
  const hash = await api.sendTransaction(transaction);
  const deadline = Date.now() + 300000;
  let onNetwork;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      onNetwork = await api.getTransaction(hash);
      if (onNetwork.status.isSuccessful() || onNetwork.status.isFailed?.()) break;
    } catch {
      // not indexed yet
    }
  }
  const ok = Boolean(onNetwork && onNetwork.status.isSuccessful());
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) throw new Error(`${label} did not succeed: ${hash}`);
  return onNetwork;
};

const view = async (safe, fn, args = []) => {
  const [value] = await contracts.query({
    contract: new Address(safe),
    function: fn,
    arguments: args
  });
  return value;
};
const num = (value) => Number(value?.toString?.() ?? value ?? 0);
const egld = (value) => Number(value) / 1e18;

const context = async (signer, safe) => ({
  chainId: 'D',
  sender: signer.address.toBech32(),
  nonce: await nonceOf(signer),
  safe
});

/**
 * The id of the action a propose transaction created, read from the contract's
 * own answer ("@ok@<id>"). Asking getActionLastIndex straight afterwards can
 * still return the previous value, which once sent a signature to an action
 * that had already been carried out.
 */
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

/**
 * Collects signatures until the quorum is met, then carries the action out.
 * Written against whatever the quorum happens to be, so a run that left it at 3
 * does not break the next one.
 */
const approveAndPerform = async (safe, actionId, others, label) => {
  const quorum = num(await view(safe, 'getQuorum'));
  const signatures = () =>
    view(safe, 'getActionSignerCount', [new U32Value(actionId)]).then(num);
  for (const [who, name] of others) {
    if ((await signatures()) >= quorum) break;
    await send(await buildSign(await context(who, safe), actionId), who, `${name} signs ${label}`);
  }
  const performer = others[0][0];
  await send(
    await buildPerform(await context(performer, safe), actionId),
    performer,
    `carry out ${label}`
  );
};

const balanceOf = async (who) => (await api.getAccount(who.address)).balance;
const tokensOf = async (address) => api.getFungibleTokensOfAccount(address);
const tokenAmount = async (address) => {
  const found = (await tokensOf(address)).find((t) => t.token.identifier === TOKEN);
  return found ? found.amount : 0n;
};

const run = async () => {
  const [alice, bob, carol] = [load('alice'), load('bob'), load('carol')];
  console.log('alice', alice.address.toBech32());
  console.log('bob  ', bob.address.toBech32());
  console.log('carol', carol.address.toBech32());

  // Keep the proposer in gas: deploys and proposals all come out of alice.
  if ((await balanceOf(alice)) < 1000000000000000000n) {
    const others = await Promise.all(
      [bob, carol].map(async (who) => [who, await balanceOf(who)])
    );
    const richest = others.sort((a, b) => (a[1] > b[1] ? -1 : 1))[0];
    if (richest[1] > 1500000000000000000n) {
      await send(
        await transfers.createTransactionForNativeTokenTransfer(richest[0].address, {
          receiver: alice.address,
          nativeAmount: 1000000000000000000n
        }),
        richest[0],
        'top alice up with 1 xEGLD'
      );
    }
  }

  // The safe. Deployed once and reused: devnet funds are finite.
  let safe;
  if (existsSync(SAFE_FILE) && !process.env.NEW_SAFE) {
    safe = readFileSync(SAFE_FILE, 'utf8').trim();
    console.log('  reusing safe:', safe);
  } else {
    const bytecode = new Uint8Array(readFileSync('scripts/devnet/multisig.wasm'));
    const factory = new SmartContractTransactionsFactory({
      config: new TransactionsFactoryConfig({ chainID: 'D' })
    });
    const deployTx = await factory.createTransactionForDeploy(alice.address, {
      bytecode,
      gasLimit: 250000000n,
      arguments: [new U32Value(2), alice.address, bob.address, carol.address],
      isUpgradeable: true,
      isReadable: true,
      isPayable: true
    });
    const deployed = await send(deployTx, alice, 'deploy a 2 of 3 safe');
    const event = (deployed.logs?.events ?? []).find((e) => e.identifier === 'SCDeploy');
    safe = event?.address?.toBech32?.() ?? String(event?.address ?? '');
    writeFileSync(SAFE_FILE, safe + '\n');
    console.log('  safe:', safe);
  }

  console.log(
    '  state: quorum',
    num(await view(safe, 'getQuorum')),
    '| board',
    num(await view(safe, 'getNumBoardMembers')),
    '| actions so far',
    num(await view(safe, 'getActionLastIndex'))
  );

  // Put something in it, if it is short.
  if ((await api.getAccount(new Address(safe))).balance < 600000000000000000n) {
    await send(
      await transfers.createTransactionForNativeTokenTransfer(alice.address, {
        receiver: new Address(safe),
        nativeAmount: 600000000000000000n
      }),
      alice,
      'send 0.6 xEGLD into the safe'
    );
  }
  if ((await tokenAmount(new Address(safe))) < 1000000000000000000n) {
    const holders = await Promise.all(
      [alice, bob, carol].map(async (who) => [who, await tokenAmount(who.address)])
    );
    const holder = holders.find(([, amount]) => amount >= 2000000000000000000n);
    if (holder) {
      const tx = await transfers.createTransactionForESDTTokenTransfer(holder[0].address, {
        receiver: new Address(safe),
        tokenTransfers: [
          new TokenTransfer({
            token: new Token({ identifier: TOKEN }),
            amount: 2000000000000000000n
          })
        ]
      });
      tx.gasLimit = 1000000n;
      await send(tx, holder[0], 'send 2 WEGLD into the safe');
    } else {
      console.log('  --  no WEGLD left in the test wallets');
    }
  }

  // 1. EGLD out: propose, second signature, carry out.
  const carolBefore = await balanceOf(carol);
  const egldProposed = await send(
    await buildProposeEgld(await context(alice, safe), {
      to: carol.address.toBech32(),
      amount: '0.1'
    }),
    alice,
    'alice proposes sending 0.1 xEGLD to carol'
  );
  const actionId = actionIdFrom(egldProposed);
  console.log(
    '  action',
    actionId,
    '| signatures after proposing:',
    num(await view(safe, 'getActionSignerCount', [new U32Value(actionId)]))
  );

  await approveAndPerform(safe, actionId, [[bob, 'bob'], [carol, 'carol']], 'the EGLD transfer');
  console.log(`  carol: ${egld(carolBefore)} -> ${egld(await balanceOf(carol))} xEGLD`);

  // 2. A token out, which on this build travels as an async ESDTTransfer.
  const tokensBefore = await tokenAmount(carol.address);
  const tokenProposed = await send(
    await buildProposeToken(await context(alice, safe), {
      to: carol.address.toBech32(),
      tokenIdentifier: TOKEN,
      amount: '0.5',
      decimals: 18
    }),
    alice,
    'alice proposes sending 0.5 WEGLD to carol'
  );
  const tokenAction = actionIdFrom(tokenProposed);
  await approveAndPerform(safe, tokenAction, [[bob, 'bob'], [carol, 'carol']], 'the token transfer');
  console.log(
    `  carol ${TOKEN}: ${egld(tokensBefore)} -> ${egld(await tokenAmount(carol.address))}`
  );

  // 3. Change the quorum, and change it back. Raising it to 3 means the change
  //    BACK needs three signatures, which is the rule working as intended.
  for (const target of [3, 2]) {
    const quorumProposed = await send(
      await buildProposeChangeQuorum(await context(alice, safe), target),
      alice,
      `alice proposes quorum ${target}`
    );
    await approveAndPerform(
      safe,
      actionIdFrom(quorumProposed),
      [[bob, 'bob'], [carol, 'carol']],
      `quorum ${target}`
    );
    console.log('  quorum now:', num(await view(safe, 'getQuorum')));
  }

  // 4. Unsign, then discard: the two ways an action ends without happening.
  const removeProposed = await send(
    await buildProposeRemoveUser(await context(alice, safe), carol.address.toBech32()),
    alice,
    'alice proposes removing carol'
  );
  const removeId = actionIdFrom(removeProposed);
  await send(
    await buildUnsign(await context(alice, safe), removeId),
    alice,
    'alice removes her signature'
  );
  console.log(
    '  signatures now:',
    num(await view(safe, 'getActionSignerCount', [new U32Value(removeId)]))
  );
  await send(await buildDiscard(await context(bob, safe), removeId), bob, 'bob discards it');

  const pending = await view(safe, 'getPendingActionFullInfo');
  console.log(
    '\nfinal: quorum',
    num(await view(safe, 'getQuorum')),
    '| pending actions',
    Array.isArray(pending) ? pending.length : 0
  );
  console.log('devnet safe:', safe);
  console.log('\nALL STEPS PASSED');
};

run().catch((error) => {
  console.error('\nFAILED:', error.message);
  process.exit(1);
});
