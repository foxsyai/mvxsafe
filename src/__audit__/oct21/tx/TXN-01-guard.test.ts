// TXN-01 and TXN-02, the parts the auditor's tests do not reach (main session,
// 21 Oct 2026):
// - a deploy signed at another nonce than the one its address was worked out
//   from is never sent, and the stored nonce goes back to where it was;
// - when the handover alone is refused, the stored nonce goes back to the
//   handover's, not past the deploy that was accepted.
// The real sdk-dapp DappProvider, store and nonce logic run; the wallet, the
// network reads and the send are fakes.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Transaction } from '@multiversx/sdk-core';
import { getAccount } from '@multiversx/sdk-dapp/out/methods/account/getAccount';
import { DappProvider } from '@multiversx/sdk-dapp/out/providers/DappProvider/DappProvider';
import { setAccountProvider } from '@multiversx/sdk-dapp/out/providers/helpers/accountProvider';
import {
  setAccount,
  setAccountNonce
} from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import { loginAction } from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import { createSafe, deploySource, SafeNotHandedOver } from 'multisig/actions';
import { predictSafeAddress } from 'multisig/legacyCalls';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const CHAIN_NONCE = 10;
const DEPLOY_RECEIVER =
  'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu';

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
  api: async () => ({ isGuarded: false }),
  networkProvider: {
    getAccount: async () => ({ nonce: 10n }),
    estimateTransactionCost: async () => ({ gasLimit: 80000000 })
  }
}));

const network = {
  sent: [] as Transaction[],
  refuseHandOver: false
};
jest.mock('@multiversx/sdk-dapp/out/managers/TransactionManager', () => ({
  TransactionManager: {
    getInstance: () => ({
      send: async (transactions: Transaction[]) => {
        for (const transaction of transactions) {
          if (
            network.refuseHandOver &&
            transaction.receiver.toBech32() !==
              'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu'
          ) {
            throw 'Too many requests';
          }
        }
        network.sent.push(...transactions);
        return transactions;
      },
      track: async () => 'session'
    })
  }
}));

/** How far ahead of what sdk-dapp gave it the wallet signs. */
const wallet = { raisesBy: 0 };
const rawProvider = {
  init: async () => true,
  isInitialized: () => true,
  getType: () => 'extension',
  getAddress: async () => ALICE,
  signTransactions: async (transactions: Transaction[]) => {
    for (const transaction of transactions) {
      transaction.nonce += BigInt(wallet.raisesBy);
      transaction.signature = new Uint8Array(64);
    }
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
});

beforeEach(() => {
  network.sent = [];
  network.refuseHandOver = false;
  wallet.raisesBy = 0;
  setAccountNonce(CHAIN_NONCE);
});

test('control: signed where predicted, both are sent and the stored nonce moves past them', async () => {
  const safe = await createSafe(alice, { quorum: 1, board: [ALICE] });
  expect(network.sent.map((transaction) => Number(transaction.nonce))).toEqual([
    10, 11
  ]);
  expect(safe).toBe(predictSafeAddress(ALICE, 10));
  expect(getAccount().nonce).toBe(12);
});

test('a safe signed at another nonce than predicted is never sent, and the nonce goes back', async () => {
  wallet.raisesBy = 1;
  await expect(
    createSafe(alice, { quorum: 1, board: [ALICE] })
  ).rejects.toThrow(/nothing was sent/);
  expect(network.sent).toEqual([]);
  expect(getAccount().nonce).toBe(CHAIN_NONCE + 1);
});

test('the same for a source', async () => {
  wallet.raisesBy = 1;
  await expect(deploySource(alice, wasm)).rejects.toThrow(/nothing was sent/);
  expect(network.sent).toEqual([]);
});

test('a refused handover leaves the nonce at the handover, after the accepted deploy', async () => {
  network.refuseHandOver = true;
  const failure = await createSafe(alice, { quorum: 1, board: [ALICE] }).catch(
    (error) => error
  );
  expect(failure).toBeInstanceOf(SafeNotHandedOver);
  expect(failure.safe).toBe(predictSafeAddress(ALICE, CHAIN_NONCE));
  expect(
    network.sent.map((transaction) => transaction.receiver.toBech32())
  ).toEqual([DEPLOY_RECEIVER]);
  expect(getAccount().nonce).toBe(CHAIN_NONCE + 1);
});
