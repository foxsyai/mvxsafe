// VBD-03: the gas formula gives too little to a vesting of many tranches. Free simulation,
// nothing is signed or sent: a wallet in shard 1 that holds TLOCKA-380a42 asks the network what
// a cancelable createBatch of one 120-tranche vesting on a v4 copy in shard 1 (zero fees) costs,
// the shipped vest-gas.mjs method; then the app's own plan for that batch is compared with it.
//
//   node src/__audit__/nov06v/build/proofs/VBD-03.mjs      (from the app directory)
//   TRANCHES=72 node ...                                      (another size)
//
// Exit 1 while what the plan gives the call is under what the call needs; 0 otherwise.
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
import {
  trancheSchedule,
  vestingGasNeed
} from '../../../../multisig/vesting.js';

const COPY = 'erd1qqqqqqqqqqqqqpgqunhaauldrd4sr73ks7a93tmmkyuxaj0mmg8sshugvn';
const SENDER = 'erd1xlydghjr4zlatf00ql4v7ga4h9lr7cmxmypgu0kgvj25pnf9pn9snn7mry';
const TOKEN = 'TLOCKA-380a42';
const TRANCHES = Number(process.env.TRANCHES ?? 120);
const UNIT = 10n ** 13n;
const MONTH = 2_629_800;

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
const sender = Address.newFromBech32(SENDER);
const nonce = BigInt((await api.getAccount(sender)).nonce);
const start = Math.floor(Date.now() / 1000) + 3600;
const tranches = Array.from({ length: TRANCHES }, (_, at) => ({
  time: start + at * MONTH,
  amount: UNIT
}));
const entries = [{ beneficiary: SENDER, schedule: trancheSchedule(tranches) }];
const sched = {
  start,
  cliff: start,
  cliff_amount: 0n,
  end: tranches[TRANCHES - 1].time,
  curve: { name: 'Tranches', fields: { 0: tranches } }
};
const tx = await factory.createTransactionForExecute(sender, {
  contract: Address.newFromBech32(COPY),
  function: 'createBatch',
  gasLimit: 0n,
  arguments: [true, 'x'.repeat(64), [sender, UNIT * BigInt(TRANCHES), sched]],
  tokenTransfers: [
    new TokenTransfer({
      token: new Token({ identifier: TOKEN }),
      amount: UNIT * BigInt(TRANCHES)
    })
  ]
});
const simulated = BigInt(
  (
    await api.estimateTransactionCost(
      new Transaction({ ...tx, nonce, gasLimit: 0n })
    )
  ).gasLimit
);
const movement = 50_000n + 1_500n * BigInt(tx.data.length);
const callNeeds = simulated - movement;
const need = vestingGasNeed({ entries, cancelable: true, feesPaid: false });
const plan = performPlan({ name: 'SendAsyncCall', callNeed: need });
const f = (v) => Number(v).toLocaleString('en-US');
console.log(`one cancelable vesting of ${TRANCHES} tranches on ${COPY}:`);
console.log(
  `  simulated ${f(simulated)} gas, of which ${f(movement)} moves the ${tx.data.length} bytes of data: the call needs ${f(callNeeds)}`
);
console.log(
  `  the formula's need is ${f(need)}; the plan gives ${f(plan.gasLimit)} in all, ${f(plan.parts.call)} of it to the call`
);
console.log(
  plan.parts.call < callNeeds
    ? `  UNDER by ${f(callNeeds - plan.parts.call)}: carried out, this runs out in mvxvest and the action is used up`
    : `  covered, with ${f(plan.parts.call - callNeeds)} to spare`
);
process.exit(plan.parts.call < callNeeds ? 1 : 0);
