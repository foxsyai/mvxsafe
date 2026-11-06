// What createBatch needs, measured by simulation on devnet: free, nothing is
// sent. A wallet in the contract's shard asks for the same call a safe would
// make, for a grid of batch sizes and tranche counts, against a copy of mvxvest
// version 4 with zero fees (vest-probe.mjs, LAYOUT=same). The figures set the
// gas the app gives a vesting carried out from a safe in another shard, where
// the network cannot simulate it as the safe.
//
//   node scripts/devnet/vest-gas.mjs [copy address] [wallet key name] [unit]
//
// unit is the raw amount of one tranche: 1000 (the first grid) or a real one,
// 1e24 for a million of an 18-decimal token. The copy's fees are read and paid.
import {
  Abi,
  Account,
  Address,
  ApiNetworkProvider,
  SmartContractTransactionsFactory,
  Token,
  TokenTransfer,
  Transaction,
  TransactionsFactoryConfig
} from '@multiversx/sdk-core';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const COPY = process.argv[2] ?? 'erd1qqqqqqqqqqqqqpgqunhaauldrd4sr73ks7a93tmmkyuxaj0mmg8sshugvn';
const WALLET = process.argv[3] ?? 'alice';
const TOKEN = 'TSAFED-e52b18';
const UNIT = BigInt(process.argv[4] ?? '1000');
const api = new ApiNetworkProvider('https://devnet-api.multiversx.com', { clientName: 'mvxsafe-devnet-test' });
const abi = Abi.create(JSON.parse(readFileSync('src/abi/mvxvest.abi.json', 'utf8')));
const factory = new SmartContractTransactionsFactory({ config: new TransactionsFactoryConfig({ chainID: 'D' }), abi });
const wallet = Account.newFromMnemonic(readFileSync(`${homedir()}/.mvxsafe-devnet/${WALLET}.mnemonic`, 'utf8').trim());
const nonce = BigInt((await api.getAccount(wallet.address)).nonce);
// Ten distinct beneficiaries, reused round-robin: the key transfers are what
// cost, not whether the address repeats.
const people = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'guardian', 'xexch', 'xnew', 'xrole']
  .filter((name) => name !== WALLET)
  .map((name) => Account.newFromMnemonic(readFileSync(`${homedir()}/.mvxsafe-devnet/${name}.mnemonic`, 'utf8').trim()).address);

const query = async (fn) => {
  const response = await fetch('https://devnet-api.multiversx.com/vm-values/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scAddress: COPY, funcName: fn, args: [] })
  }).then((r) => r.json());
  const hex = Buffer.from(response?.data?.data?.returnData?.[0] ?? '', 'base64').toString('hex');
  return BigInt(`0x${hex || '0'}`);
};
const FEE = await query('getFee');
const BPS = await query('getTokenFee');

const need = async (entries, tranches, cancelable, labelBytes = 64) => {
  const start = Math.floor(Date.now() / 1000) + 3600;
  const schedule = {
    start,
    cliff: start,
    cliff_amount: 0n,
    end: start + (tranches - 1) * 15_778_800,
    curve: { name: 'Tranches', fields: { 0: Array.from({ length: tranches }, (_, at) => ({ time: start + at * 15_778_800, amount: UNIT })) } }
  };
  const total = UNIT * BigInt(tranches);
  const rows = Array.from({ length: entries }, (_, at) => [people[at % people.length], total, schedule]);
  const tokenFee = ((total * BPS) / 10000n) * BigInt(entries);
  const payments = [new TokenTransfer({ token: new Token({ identifier: TOKEN }), amount: total * BigInt(entries) + tokenFee })];
  if (FEE > 0n) payments.push(TokenTransfer.newFromNativeAmount(FEE * BigInt(entries)));
  const transaction = await factory.createTransactionForExecute(wallet.address, {
    contract: Address.newFromBech32(COPY),
    function: 'createBatch',
    gasLimit: 0n,
    arguments: [cancelable, 'x'.repeat(labelBytes), ...rows],
    tokenTransfers: payments
  });
  const trial = new Transaction({ ...transaction, nonce, gasLimit: 0n });
  const dataBytes = transaction.data.length;
  try {
    const cost = await api.estimateTransactionCost(trial);
    return { gas: Number(cost.gasLimit), dataBytes };
  } catch (error) {
    return { gas: null, dataBytes, error: String(error?.message ?? error).slice(0, 140) };
  }
};

console.log(`copy ${COPY}, wallet ${WALLET} ${wallet.address.toBech32()}, tranche ${UNIT}, fees ${FEE} EGLD units + ${BPS} bps`);
console.log('entries tranches cancelable  dataBytes  gas');
const grid = (process.env.GRID ?? '1x1,1x2,1x8,1x24,1x120,2x2,2x8,4x8,8x8,16x8,32x8,32x24,32x1,49x8')
  .split(',')
  .map((cell) => cell.split('x').map(Number));
for (const cancelable of [true, false]) {
  for (const [entries, tranches] of grid) {
    if (cancelable && entries > 32) continue;
    const result = await need(entries, tranches, cancelable);
    console.log(`${String(entries).padStart(7)} ${String(tranches).padStart(8)} ${String(cancelable).padStart(10)} ${String(result.dataBytes).padStart(10)}  ${result.gas?.toLocaleString('en-US') ?? `refused: ${result.error}`}`);
  }
}
