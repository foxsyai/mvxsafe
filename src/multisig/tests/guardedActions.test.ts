/**
 * @jest-environment node
 */
// Every transaction the app sends, from a wallet with a guardian (two of the
// three mainnet signers of the safe that owns mvxvest have one). For each the
// guardian must be on the transaction BEFORE the network simulates it, since
// the network refuses to simulate a guarded account's transaction without it
// ("not allowed to bypass guardian", mainnet, 13 Oct 2026), and 50,000 must be
// added to its limit afterwards, budgets included.
// What reaches the wallet: through signAndSendTransactions, or, for a deploy,
// signed first on its own so its nonce can be checked (TXN-01, 21 Oct 2026).
jest.mock('helpers/signAndSendTransactions', () => ({
  nonceToSign: (nonce: number) => nonce,
  sendSigned: async (signed: unknown[]) => signed,
  signAndSendTransactions: jest.fn(async ({ transactions }) => {
    (globalThis as any).__sent = transactions;
    return 'session';
  }),
  signOnly: jest.fn(async (transactions: unknown[]) => {
    (globalThis as any).__sent = transactions;
    return transactions;
  }),
  trackSent: async () => 'session',
  windNonceBack: () => undefined
}));
jest.mock('multisig/network', () => ({
  chainId: 'D',
  forget: () => undefined,
  api: async (path: string) =>
    /withGuardianInfo/.test(path)
      ? {
          isGuarded: true,
          activeGuardianAddress:
            'erd13n5qd94ukuu2s2e3dppavdp0v7q89hj0nk9x2tulhlqyu6hcxy9s3xw87f'
        }
      : {},
  networkProvider: {
    getAccount: async () => ({ nonce: 5n }),
    estimateTransactionCost: jest.fn(async (transaction: any) => {
      (globalThis as any).__simulated.push({
        guardian: transaction.guardian.toBech32(),
        version: transaction.version,
        options: transaction.options
      });
      return { gasLimit: 5000000 };
    })
  }
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import * as actions from 'multisig/actions';
import { GUARDIAN_GAS, handOverGas } from 'multisig/gas';
import { predictSafeAddress } from 'multisig/legacyCalls';

const GUARDIAN =
  'erd13n5qd94ukuu2s2e3dppavdp0v7q89hj0nk9x2tulhlqyu6hcxy9s3xw87f';
const DAVE = 'erd1wdqwnz0kdswj6njp0yzllkd5q4km9ygvtkme4zlg5kn026mdzc0s77fspw'; // shard 1
const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf'; // shard 1
const VEST = 'erd1qqqqqqqqqqqqqpgqntmhxqa29ar4juhlprjjxaq790ykcj3uaujq2l9dzg'; // shard 0
const SOURCE = 'erd1qqqqqqqqqqqqqpgqsy2ept5xx2cprx3htj0l5lwkk52hh9amxezsygtpgl'; // shard 1
const dave = { address: DAVE, nonce: 5 };
const SIMULATED = 6000000n; // 5,000,000 plus a fifth
const wasm = new Uint8Array(
  readFileSync(join(__dirname, '../../../public/contracts/multisig.wasm'))
);

const sent = () => (globalThis as any).__sent;

beforeEach(() => {
  (globalThis as any).__simulated = [];
  jest.clearAllMocks();
});

const simulatedPaths: [string, () => Promise<unknown>][] = [
  [
    'propose an upgrade',
    () =>
      actions.proposeUpgrade(dave, SAFE, {
        target: VEST,
        source: SOURCE,
        metadata: {
          upgradeable: true,
          readable: true,
          payable: false,
          payableBySc: false
        }
      })
  ],
  [
    'propose a call',
    () =>
      actions.proposeCall(dave, SAFE, {
        to: VEST,
        functionName: 'setFee',
        args: [{ kind: 'egld', value: '0' }]
      })
  ],
  ['sign', () => actions.signAction(dave, SAFE, 4)],
  ['unsign', () => actions.unsignAction(dave, SAFE, 4)],
  ['discard', () => actions.discardAction(dave, SAFE, 4)],
  [
    'carry out what stays in the safe',
    () => actions.performAction(dave, SAFE, 4)
  ],
  ['deploy a source', () => actions.deploySource(dave, wasm)],
  ['propose EGLD', () => actions.proposeSendEgld(dave, SAFE, ALICE, '1')],
  [
    'propose a token',
    () => actions.proposeSendToken(dave, SAFE, ALICE, 'WEGLD-a28c59', '1', 18)
  ],
  [
    'propose a board member',
    () => actions.proposeAddBoardMember(dave, SAFE, ALICE)
  ],
  ['propose a proposer', () => actions.proposeAddProposer(dave, SAFE, ALICE)],
  ['propose a removal', () => actions.proposeRemoveUser(dave, SAFE, ALICE)],
  ['propose a quorum', () => actions.proposeChangeQuorum(dave, SAFE, 2)],
  ['hand a safe to itself', () => actions.handOverSafe(dave, SAFE)]
];

test.each(simulatedPaths)(
  '%s: the guardian is on before the simulation, and 50,000 is added after',
  async (_, run) => {
    await run();
    expect((globalThis as any).__simulated).toEqual([
      { guardian: GUARDIAN, version: 2, options: 2 }
    ]);
    const [transaction] = sent();
    expect(transaction.guardian.toBech32()).toBe(GUARDIAN);
    expect(transaction.gasLimit).toBe(SIMULATED + GUARDIAN_GAS);
  }
);

test('carry out with a budget: not simulated, guarded, and 50,000 on top of the budget', async () => {
  await actions.performAction(dave, SAFE, 4, 25300000n);
  expect((globalThis as any).__simulated).toEqual([]);
  const [transaction] = sent();
  expect(transaction.guardian.toBech32()).toBe(GUARDIAN);
  expect(transaction.options & 2).toBe(2);
  expect(transaction.gasLimit).toBe(25300000n + GUARDIAN_GAS);
});

test('creating a safe: the deploy simulated, the handover at the fixed cost, both guarded', async () => {
  (globalThis as any).fetch = async () => ({
    ok: true,
    arrayBuffer: async () =>
      wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
  });
  const safe = await actions.createSafe(dave, {
    quorum: 2,
    board: [DAVE, ALICE]
  });
  expect(safe).toBe(predictSafeAddress(DAVE, 5));
  const [deploy, handOver] = sent();
  expect((globalThis as any).__simulated).toHaveLength(1);
  expect(deploy.guardian.toBech32()).toBe(GUARDIAN);
  expect(deploy.gasLimit).toBe(SIMULATED + GUARDIAN_GAS);
  expect(handOver.guardian.toBech32()).toBe(GUARDIAN);
  expect(handOver.gasLimit).toBe(
    handOverGas(handOver.data.length) + GUARDIAN_GAS
  );
  expect(handOverGas(handOver.data.length)).toBe(6209400n);
  expect(handOver.nonce).toBe(deploy.nonce + 1n);
});
