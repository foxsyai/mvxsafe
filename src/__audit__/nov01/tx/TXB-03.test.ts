// TXB-03: a deploy whose POST times out after the network accepted it is
// treated as never sent, and the safe it created is lost.
//
// sdk-dapp posts a transaction with a 4 s timeout (fallbackNetworkConfigurations
// apiTimeout "4000"; the app passes none of its own). A safe deploy carries the
// 23 KB contract as 47 KB of data, and the public API has answered in 18 s on
// a bad day (7 Oct 2026). When the POST is accepted but the answer arrives
// late, axios throws "timeout of 4000ms exceeded", sendSigned winds the nonce
// back, createSafe rejects with that message, and the create page shows
// "Creating the safe may still have gone through" with nothing to open. The
// safe exists at the predicted address, owned by the deployer's wallet, its
// handover never sent, and the app has forgotten the address. The next press
// of Create predicts a new address from the chain's next nonce and makes a
// second safe.
//
// Correct behaviour: when the network holds the deploy (its hash answers, or
// the account's nonce has moved past it), the safe is reported, as a
// SafeNotHandedOver naming it (so the page saves and opens it and offers the
// handover) or as the created address, and the stored nonce is not wound back
// past the accepted deploy.
//
// The real sdk-dapp DappProvider and store run; the wallet, the network reads
// and the send are fakes. Nothing touches a network.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Transaction, TransactionComputer } from '@multiversx/sdk-core';
import { getAccount } from '@multiversx/sdk-dapp/out/methods/account/getAccount';
import { DappProvider } from '@multiversx/sdk-dapp/out/providers/DappProvider/DappProvider';
import { setAccountProvider } from '@multiversx/sdk-dapp/out/providers/helpers/accountProvider';
import {
  setAccount,
  setAccountNonce
} from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import { loginAction } from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import {
  createSafe,
  SafeNotHandedOver,
  SafeUnconfirmed,
  signAction
} from 'multisig/actions';
import { predictSafeAddress } from 'multisig/legacyCalls';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
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

/** What the network holds: the hashes it accepted, and the account's nonce. */
const chain = {
  accepted: new Set<string>(),
  nonce: 10,
  /** The contracts that hold code. */
  code: new Set<string>()
};
const hashOf = (transaction: Transaction) =>
  new TransactionComputer().computeTransactionHash(transaction);

jest.mock('multisig/network', () => ({
  chainId: 'D',
  forget: () => undefined,
  api: async (path: string) => {
    const hash = /^\/transactions\/([0-9a-f]{64})/.exec(path);
    if (hash) {
      if (!chain.accepted.has(hash[1])) throw new Error(`${path} answered 404`);
      return { txHash: hash[1], status: 'pending' };
    }
    if (/^\/accounts\//.test(path))
      return {
        isGuarded: false,
        nonce: chain.nonce,
        codeHash: chain.code.has(path.split('/')[2].split('?')[0])
          ? 'aGFzaA=='
          : undefined
      };
    throw new Error(`${path} answered 404`);
  },
  networkProvider: {
    getAccount: async () => ({ nonce: BigInt(chain.nonce) }),
    getTransaction: async (hash: string) => {
      if (!chain.accepted.has(hash)) throw new Error('transaction not found');
      return { hash, status: { status: 'pending' } };
    },
    getTransactionStatus: async (hash: string) => {
      if (!chain.accepted.has(hash)) throw new Error('transaction not found');
      return { status: 'pending' };
    },
    estimateTransactionCost: async () => ({ gasLimit: 80000000 })
  }
}));

/** How the POST ends: 'late' means accepted, but the answer came after the timeout. */
const post = {
  /** Every receiver a POST was attempted for. */
  to: [] as string[],
  /** A signature's POST loses its answer while another transaction takes its nonce. */
  otherTakesNonce: false,
  deploy: 'ok' as 'ok' | 'late' | 'refused' | 'lost' | 'late-unindexed'
};
jest.mock('@multiversx/sdk-dapp/out/managers/TransactionManager', () => ({
  TransactionManager: {
    getInstance: () => ({
      send: async (transactions: Transaction[]) => {
        for (const transaction of transactions) {
          post.to.push(transaction.receiver.toBech32());
          if (post.otherTakesNonce) {
            chain.nonce = Number(transaction.nonce) + 1;
            throw 'timeout of 4000ms exceeded';
          }
          const isDeploy =
            transaction.receiver.toBech32() ===
            'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu';
          if (isDeploy && post.deploy === 'refused') {
            throw 'insufficient funds';
          }
          if (isDeploy && post.deploy === 'lost') {
            throw 'timeout of 4000ms exceeded';
          }
          // Processed, but the API does not show its hash yet.
          if (isDeploy && post.deploy === 'late-unindexed') {
            chain.nonce = Number(transaction.nonce) + 1;
            throw 'timeout of 4000ms exceeded';
          }
          chain.accepted.add(hashOf(transaction));
          if (isDeploy && post.deploy === 'late') {
            throw 'timeout of 4000ms exceeded';
          }
        }
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
const PREDICTED = predictSafeAddress(ALICE, CHAIN_NONCE);

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
  chain.accepted.clear();
  chain.nonce = CHAIN_NONCE;
  post.deploy = 'ok';
  post.to = [];
  post.otherTakesNonce = false;
  chain.code.clear();
  setAccountNonce(CHAIN_NONCE);
});

test('control: both accepted, the safe is where predicted', async () => {
  await expect(createSafe(alice, { quorum: 1, board: [ALICE] })).resolves.toBe(
    PREDICTED
  );
  expect(getAccount().nonce).toBe(CHAIN_NONCE + 2);
});

test('control: a deploy the network refused is nothing, and the nonce goes back', async () => {
  post.deploy = 'refused';
  await expect(
    createSafe(alice, { quorum: 1, board: [ALICE] })
  ).rejects.not.toBeInstanceOf(SafeNotHandedOver);
  expect(chain.accepted.size).toBe(0);
  expect(getAccount().nonce).toBe(CHAIN_NONCE);
});

test('the deploy was accepted but its answer came late: the safe is reported, not forgotten', async () => {
  post.deploy = 'late';
  const outcome = await createSafe(alice, { quorum: 1, board: [ALICE] }).then(
    (safe) => ({ safe }),
    (failure) => ({ failure })
  );
  // The network holds the deploy, so the safe exists at the predicted address.
  expect(chain.accepted.size).toBeGreaterThanOrEqual(1);
  const reported =
    'safe' in outcome
      ? outcome.safe
      : outcome.failure instanceof SafeNotHandedOver
        ? outcome.failure.safe
        : null;
  expect(reported).toBe(PREDICTED);
  // And the stored nonce is not wound back past the accepted deploy.
  expect(getAccount().nonce).toBeGreaterThanOrEqual(CHAIN_NONCE + 1);
});

test('the API does not show its hash yet, but the predicted address holds code: the safe is reported', async () => {
  post.deploy = 'late-unindexed';
  chain.code.add(PREDICTED);
  const outcome = await createSafe(alice, { quorum: 1, board: [ALICE] }).then(
    (safe) => ({ safe }),
    (failure) => ({ failure })
  );
  const reported =
    'safe' in outcome
      ? outcome.safe
      : outcome.failure instanceof SafeNotHandedOver
        ? outcome.failure.safe
        : null;
  expect(reported).toBe(PREDICTED);
  expect(getAccount().nonce).toBeGreaterThanOrEqual(CHAIN_NONCE + 1);
});

test('the nonce moved past it, with no hash and no code: another transaction took it, so no handover and no success', async () => {
  post.deploy = 'late-unindexed';
  const failure = await createSafe(alice, { quorum: 1, board: [ALICE] }).catch(
    (reason) => reason
  );
  expect(failure).toBeInstanceOf(SafeUnconfirmed);
  expect(failure.safe).toBe(PREDICTED);
  expect(post.to).not.toContain(PREDICTED);
}, 15000);

test('an ordinary transaction whose nonce another one took is not reported as sent', async () => {
  post.otherTakesNonce = true;
  await expect(signAction(alice, PREDICTED, 7)).rejects.toMatch(/timeout/);
}, 15000);

test('control: an ordinary transaction whose hash answers is sent, its answer lost or not', async () => {
  post.deploy = 'ok';
  await expect(signAction(alice, PREDICTED, 7)).resolves.toBe('session');
});

test('the answer was lost and the network does not show it: the nonce goes back, and the address is still given', async () => {
  post.deploy = 'lost';
  const failure = await createSafe(alice, { quorum: 1, board: [ALICE] }).catch(
    (reason) => reason
  );
  expect(failure).toBeInstanceOf(SafeUnconfirmed);
  expect(failure.safe).toBe(PREDICTED);
  expect(failure.message).toMatch(/may still have gone through/);
  expect(chain.accepted.size).toBe(0);
  expect(getAccount().nonce).toBe(CHAIN_NONCE);
}, 15000);
