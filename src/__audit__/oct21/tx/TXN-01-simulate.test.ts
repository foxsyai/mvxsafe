// TXN-01, found by the review of PR #11 (21 Oct 2026): the fix predicted the
// new contract's address from sdk-dapp's nonce, but it also SIMULATED every
// transaction at that nonce. The cost endpoint checks the nonce against the
// account and answers "higher nonce in transaction" while a transaction from
// this tab waits in the pool (seen on devnet, TXN-05). So in TXN-01's own
// window every simulated action stopped with "try again", where before it
// went through: sdk-dapp raises the nonce at signing anyway.
//
// Correct behaviour: simulate at the chain's nonce, sign at sdk-dapp's.
//
// The real sdk-dapp DappProvider, store and nonce logic run; the wallet, the
// network reads and the send are fakes. The fake cost endpoint refuses any
// nonce but the chain's, as the network does.
import { readFileSync } from 'fs';
import { join } from 'path';
import { ErrEstimateTransactionCost, Transaction } from '@multiversx/sdk-core';
import { DappProvider } from '@multiversx/sdk-dapp/out/providers/DappProvider/DappProvider';
import { setAccountProvider } from '@multiversx/sdk-dapp/out/providers/helpers/accountProvider';
import {
  setAccount,
  setAccountNonce
} from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import { loginAction } from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import { createSafe, deploySource, signAction } from 'multisig/actions';
import { predictSafeAddress } from 'multisig/legacyCalls';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const SAFE = 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
const CHAIN_NONCE = 10;

jest.mock('@multiversx/sdk-dapp/out/utils/account/fetchAccount', () => ({
  fetchAccount: jest.fn(async () => ({
    address: 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3',
    nonce: 10,
    balance: '1946050635000000000',
    isGuarded: false,
    shard: 1,
    username: ''
  }))
}));

jest.mock('multisig/network', () => ({
  chainId: 'D',
  forget: () => undefined,
  api: async () => ({ isGuarded: false }),
  networkProvider: {
    getAccount: async () => ({ nonce: 10n }),
    estimateTransactionCost: async (transaction: any) => {
      const nonce = Number(transaction.nonce);
      if (nonce !== 10) {
        const { ErrEstimateTransactionCost: Refusal } = jest.requireActual(
          '@multiversx/sdk-core'
        );
        throw new Refusal(
          `${nonce > 10 ? 'higher' : 'lower'} nonce in transaction: `
        );
      }
      return { gasLimit: 80000000 };
    }
  }
}));

const network = { sent: [] as Transaction[] };
jest.mock('@multiversx/sdk-dapp/out/managers/TransactionManager', () => ({
  TransactionManager: {
    getInstance: () => ({
      send: async (transactions: Transaction[]) => {
        network.sent.push(...transactions);
        return transactions;
      },
      track: async () => 'session'
    })
  }
}));

const rawProvider = {
  init: async () => true,
  isInitialized: () => true,
  getType: () => 'extension',
  getAddress: async () => ALICE,
  signTransactions: async (transactions: Transaction[]) => {
    for (const transaction of transactions)
      transaction.signature = new Uint8Array(64);
    return transactions;
  }
};

const wasm = new Uint8Array(
  readFileSync(join(__dirname, '../../../../public/contracts/multisig.wasm'))
);
const alice = { address: ALICE, nonce: CHAIN_NONCE };

beforeAll(() => {
  (globalThis as any).fetch = async () => ({
    ok: true,
    arrayBuffer: async () =>
      wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
  });
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
      value: require('crypto').webcrypto,
      configurable: true
    });
  }
  loginAction({ address: ALICE, providerType: 'extension' } as any);
  setAccount({
    address: ALICE,
    nonce: CHAIN_NONCE,
    balance: '1946050635000000000',
    isGuarded: false
  } as any);
  setAccountProvider(new DappProvider(rawProvider as any));
  // The refusal class is the real one, so the gas code treats it as the network's.
  expect(new ErrEstimateTransactionCost('x')).toBeInstanceOf(Error);
});

beforeEach(() => {
  network.sent = [];
  setAccountNonce(CHAIN_NONCE);
});

test('control: with nothing in the pool, a signature is simulated and sent', async () => {
  await signAction(alice, SAFE, 7);
  expect(network.sent.map((transaction) => Number(transaction.nonce))).toEqual([
    10
  ]);
});

test('a second signature moments after the first goes through, at the next nonce', async () => {
  await signAction(alice, SAFE, 7);
  await signAction(alice, SAFE, 8);
  expect(network.sent.map((transaction) => Number(transaction.nonce))).toEqual([
    10, 11
  ]);
});

test('a safe created moments after a signature goes through, where the app says', async () => {
  await signAction(alice, SAFE, 7);
  const safe = await createSafe(alice, { quorum: 1, board: [ALICE] });
  const [, deploy, handOver] = network.sent;
  expect(Number(deploy.nonce)).toBe(11);
  expect(safe).toBe(predictSafeAddress(ALICE, 11));
  expect(handOver.receiver.toBech32()).toBe(safe);
  expect(Number(handOver.nonce)).toBe(12);
});

test('the same for a source', async () => {
  await signAction(alice, SAFE, 7);
  const source = await deploySource(alice, wasm);
  const [, deploy] = network.sent;
  expect(Number(deploy.nonce)).toBe(11);
  expect(source).toBe(predictSafeAddress(ALICE, 11));
});
