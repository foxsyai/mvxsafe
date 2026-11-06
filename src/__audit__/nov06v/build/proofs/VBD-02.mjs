// VBD-02: a beneficiary that is a smart contract not payable by contracts, in mvxvest's own
// shard, makes createBatch fail; vestingProblem lets it through. Free simulation, nothing is
// signed or sent: a wallet in shard 1 that holds TLOCKA-380a42 asks the network what a
// createBatch on a v4 copy in shard 1 would cost, with such a contract as the beneficiary.
//
//   node src/__audit__/nov06v/build/proofs/VBD-02.mjs      (from the app directory)
//
// Exit 1 while the network refuses the call and vestingProblem accepts the same beneficiary;
// 0 once vestingProblem refuses it; 2 when the network's answer is not the expected refusal.
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
import {
  trancheSchedule,
  vestingProblem
} from '../../../../multisig/vesting.js';

const COPY = 'erd1qqqqqqqqqqqqqpgqunhaauldrd4sr73ks7a93tmmkyuxaj0mmg8sshugvn';
const SENDER = 'erd1xlydghjr4zlatf00ql4v7ga4h9lr7cmxmypgu0kgvj25pnf9pn9snn7mry';
const TOKEN = 'TLOCKA-380a42';
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqsy2ept5xx2cprx3htj0l5lwkk52hh9amxezsygtpgl'; // shard 1, not payable by contracts
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';

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
const sched = {
  start,
  cliff: start,
  cliff_amount: 0n,
  end: start,
  curve: { name: 'Tranches', fields: { 0: [{ time: start, amount: 1000n }] } }
};
const tx = await factory.createTransactionForExecute(sender, {
  contract: Address.newFromBech32(COPY),
  function: 'createBatch',
  gasLimit: 0n,
  arguments: [true, 'audit', [Address.newFromBech32(CONTRACT), 1000n, sched]],
  tokenTransfers: [
    new TokenTransfer({
      token: new Token({ identifier: TOKEN }),
      amount: 1000n
    })
  ]
});
let refusal = '';
try {
  const cost = await api.estimateTransactionCost(
    new Transaction({ ...tx, nonce, gasLimit: 0n })
  );
  console.log(
    `the network simulated it at ${Number(cost.gasLimit).toLocaleString('en-US')} gas: not the refusal expected`
  );
} catch (error) {
  refusal = String(error?.message ?? error).replace(/\s+/g, ' ');
  console.log(
    `the network refuses createBatch to ${CONTRACT}: ${refusal.slice(0, 160)}`
  );
}
if (!/non payable/i.test(refusal)) process.exit(2);

const problem = vestingProblem({
  pin: {
    address: COPY,
    codeHashes: [V4],
    claimKey: 'VESTKEY-bf5b96',
    cancelKey: 'VESTCANCEL-22a1f8'
  },
  facts: {
    codeHash: V4,
    creationPaused: false,
    claimKeyIssued: true,
    cancelKeyIssued: true,
    fee: 0n,
    tokenFeeBps: 0,
    safePayableBySc: true,
    safeBalance: 10n ** 24n,
    safeEgld: 10n ** 18n
  },
  safe: SAFE,
  token: TOKEN,
  cancelable: true,
  label: 'audit',
  entries: [
    {
      beneficiary: CONTRACT,
      schedule: trancheSchedule([{ time: start, amount: 1000n }])
    }
  ]
});
console.log(
  `vestingProblem says: ${problem ? JSON.stringify(problem) : '(nothing: it would be proposed, signed and used up)'}`
);
process.exit(problem ? 0 : 1);
