// TXN-01: a safe (or a source) is created at an address the app did not
// predict, because the nonce the app predicts from is not the nonce the wallet
// signs with.
//
// createSafe and deploySource (src/multisig/actions.ts) read the account's
// nonce from the API (contextOf), predict the contract's address from it
// (predictSafeAddress) and, for a safe, write that address into the handover
// (ChangeOwnerAddress@<safe>) signed together with the deploy. The wallet is
// then driven by sdk-dapp, whose computeNonce only ever RAISES a nonce to its
// own latest one: max(tracked + 1, fetched, stored). Right after any send from
// this tab, sdk-dapp's stored nonce is one ahead of the chain for as long as
// that transaction waits in the pool, while the API still reports the old
// nonce. In that window the deploy is signed one nonce higher than predicted:
// the safe is created at another address, the handover goes to an address
// with no contract and fails, the page navigates to and saves an address that
// never becomes a safe, and the real safe stays owned by the deployer's
// wallet. deploySource returns an address whose code never appears.
//
// Correct behaviour: the address the app reports, saves and names in the
// handover is the address of the contract the signed deploy creates.
//
// The real sdk-dapp DappProvider, store and nonce logic drive the real
// createSafe and deploySource; only the wallet, the network reads and the send
// are fakes. Nothing touches a network.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Transaction } from '@multiversx/sdk-core';
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
// The chain: alice is at 10 and stays there, because the transaction sent
// moments ago is still waiting in the pool.
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

// The app's own reads: the same chain nonce, no guardian, a simulation that answers.
jest.mock('multisig/network', () => ({
  chainId: 'D',
  api: async () => ({ isGuarded: false }),
  networkProvider: {
    getAccount: async () => ({ nonce: 10n }),
    estimateTransactionCost: async () => ({ gasLimit: 80000000 })
  }
}));

// The network accepts whatever is sent; what was sent is kept for the assertions.
const network = { sent: [] as Transaction[][] };
jest.mock('@multiversx/sdk-dapp/out/managers/TransactionManager', () => ({
  TransactionManager: {
    getInstance: () => ({
      send: async (transactions: Transaction[]) => {
        network.sent.push(transactions);
        return transactions;
      },
      track: async () => 'session'
    })
  }
}));

// The wallet signs whatever it is given.
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
const text = (data: Uint8Array) => Buffer.from(data).toString();
// Everything sent, in order, however many sends it took: since TXN-02 the
// deploy and the handover go out one after the other (main session, 21 Oct 2026).
const sentInOrder = () => network.sent.flat();
const alice = { address: ALICE, nonce: CHAIN_NONCE };

beforeAll(() => {
  // The page loads the contract from the site; here from the repository.
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
});

describe('TXN-01: the address the app predicts is the address the signed deploy creates', () => {
  test('control: with nothing in the pool, the safe is where the app says and the handover names it', async () => {
    setAccountNonce(CHAIN_NONCE);
    const safe = await createSafe(alice, { quorum: 1, board: [ALICE] });
    const [deploy, handOver] = sentInOrder();
    const created = predictSafeAddress(ALICE, Number(deploy.nonce));
    expect(safe).toBe(created);
    expect(handOver.receiver.toBech32()).toBe(created);
    expect(text(handOver.data)).toContain(
      Buffer.from(
        require('@multiversx/sdk-core')
          .Address.newFromBech32(created)
          .getPublicKey()
      ).toString('hex')
    );
  });

  test('a transaction sent moments ago is still in the pool: the safe is created elsewhere and the handover goes to an empty address', async () => {
    setAccountNonce(CHAIN_NONCE);
    // A signature sent from this tab a moment ago: the chain still says 10,
    // sdk-dapp's store already says 11.
    await signAction(alice, SAFE, 7);
    expect(Number(network.sent[0][0].nonce)).toBe(CHAIN_NONCE);

    const safe = await createSafe(alice, { quorum: 1, board: [ALICE] });
    const [, deploy, handOver] = sentInOrder();
    const created = predictSafeAddress(ALICE, Number(deploy.nonce));
    // What is signed is one ahead of what was predicted from (the scenario).
    expect(Number(deploy.nonce)).toBe(CHAIN_NONCE + 1);
    // The address reported, saved and navigated to must be the one created.
    expect(safe).toBe(created);
    // And the handover must hand over THAT safe, not an address with no contract.
    expect(handOver.receiver.toBech32()).toBe(created);
  });

  test('the same for a source: the address returned is where the code will be', async () => {
    setAccountNonce(CHAIN_NONCE);
    await signAction(alice, SAFE, 7);

    const source = await deploySource(alice, wasm);
    const [, deploy] = sentInOrder();
    expect(Number(deploy.nonce)).toBe(CHAIN_NONCE + 1);
    expect(source).toBe(predictSafeAddress(ALICE, Number(deploy.nonce)));
  });
});
