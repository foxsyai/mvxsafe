// VBD-04: a cancel of a vesting of many tranches needs far more than the flat 10M the app gives
// it. Free simulation, nothing is signed or sent: the wallet in shard 1 that holds the cancel
// keys of vestings #3 (120 tranches) and #4 (1 tranche) on a v4 copy in shard 1 asks the network
// what cancelling each would cost, and the app's plan for a cancel is compared with it.
//
//   node src/__audit__/nov06v/build/proofs/VBD-04.mjs      (from the app directory)
//
// Exit 1 while what the plan gives the call is under what the 120-tranche cancel needs; 0 once it
// covers it; 2 when the keys are no longer where they were on 6 Nov 2026.
import {
  Abi,
  Address,
  ApiNetworkProvider,
  SmartContractTransactionsFactory,
  Token,
  TokenTransfer,
  Transaction,
  TransactionsFactoryConfig
} from '@multiversx/sdk-core';
import { readFileSync } from 'node:fs';
import { performPlan } from '../../../../multisig/gas.js';
import { cancelGasNeed } from '../../../../multisig/vesting.js';

const COPY = 'erd1qqqqqqqqqqqqqpgqunhaauldrd4sr73ks7a93tmmkyuxaj0mmg8sshugvn';
const HOLDER = 'erd1xlydghjr4zlatf00ql4v7ga4h9lr7cmxmypgu0kgvj25pnf9pn9snn7mry';
const KEYS = [
  ['VESTCANCEL-22a1f8', 3n, 120],
  ['VESTCANCEL-22a1f8', 4n, 1]
];

const api = new ApiNetworkProvider('https://devnet-api.multiversx.com', {
  clientName: 'mvxsafe-audit-proof'
});
const abi = Abi.create(
  JSON.parse(
    readFileSync(
      new URL('../../../../abi/mvxvest.abi.json', import.meta.url),
      'utf8'
    )
  )
);
const factory = new SmartContractTransactionsFactory({
  config: new TransactionsFactoryConfig({ chainID: 'D' }),
  abi
});
const holder = Address.newFromBech32(HOLDER);
const nonce = BigInt((await api.getAccount(holder)).nonce);
// Since the fix, the card sizes a cancel from its vesting's tranches
// (cancelGasNeed), as vestingCard.ts does for each key (main session, 6 Nov).
const planFor = (tranches) =>
  performPlan({ name: 'SendAsyncCall', callNeed: cancelGasNeed(tranches) });
const f = (v) => Number(v).toLocaleString('en-US');
let under = false;
for (const [collection, keyNonce, tranches] of KEYS) {
  const tx = await factory.createTransactionForExecute(holder, {
    contract: Address.newFromBech32(COPY),
    function: 'cancel',
    gasLimit: 0n,
    arguments: [],
    tokenTransfers: [
      new TokenTransfer({
        token: new Token({ identifier: collection, nonce: keyNonce }),
        amount: 1n
      })
    ]
  });
  let simulated;
  try {
    simulated = BigInt(
      (
        await api.estimateTransactionCost(
          new Transaction({ ...tx, nonce, gasLimit: 0n })
        )
      ).gasLimit
    );
  } catch (error) {
    console.log(
      `cancel of ${collection}-${keyNonce.toString(16).padStart(2, '0')} could not be simulated: ${String(
        error?.message ?? error
      )
        .replace(/\s+/g, ' ')
        .slice(0, 160)}`
    );
    process.exit(2);
  }
  const callNeeds = simulated - (50_000n + 1_500n * BigInt(tx.data.length));
  const plan = planFor(tranches);
  console.log(
    `the app's plan for it: ${f(plan.gasLimit)} in all, ${f(plan.parts.call)} of it to the call`
  );
  const short = plan.parts.call < callNeeds;
  console.log(
    `cancel of the ${tranches}-tranche vesting: simulated ${f(simulated)}, the call needs ${f(callNeeds)}: ${short ? `UNDER by ${f(callNeeds - plan.parts.call)}` : 'covered'}`
  );
  if (short) under = true;
}
process.exit(under ? 1 : 0);
