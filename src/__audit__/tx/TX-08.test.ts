// TX-08: one failed send leaves the wallet signing every later transaction one
// nonce ahead of the chain, and those transactions execute later.
//
// The app's signAndSendTransactions (src/helpers/signAndSendTransactions.ts)
// calls sdk-dapp's provider.signTransactions and then TransactionManager.send.
// Inside sdk-dapp 5.7.2, signTransactionsWithProvider ends with
// setAccountNonce(nonce + signed.length) THE MOMENT THE WALLET HAS SIGNED,
// before anything is sent. If the send then fails (a 429 from the public API,
// a 400 for "insufficient funds" for the fee, a network blip), the chain stays
// at nonce N but sdk-dapp's store says N+1. At the next sign, refreshAccount
// computes getLatestNonce = max(tracked+1, fetched N, stored N+1) = N+1, and
// computeNonce keeps the app's own nonce N only when it is HIGHER, so the
// wallet is asked to sign N+1. The network accepts a nonce-gap transaction as
// "pending" and executes it as soon as the gap is filled (devnet: bob's nonce
// 47 note sat pending for a minute and ran the moment nonce 46 landed, see
// proofs/TX-08-nonce-gap.mjs and the report). The store is persisted in
// sessionStorage, so reloading the tab does not help.
//
// Correct behaviour: after a failed send, the next transaction is signed with
// the chain's nonce. (The app can restore sdk-dapp's stored nonce in a catch,
// or stop depending on sdk-dapp's nonce bookkeeping.)
//
// This test wires the real app helper to the real sdk-dapp DappProvider, store
// and nonce logic; only the wallet, the account fetch and the network send are
// fakes. Nothing touches a network.
import { Transaction } from '@multiversx/sdk-core';
import { DappProvider } from '@multiversx/sdk-dapp/out/providers/DappProvider/DappProvider';
import { setAccountProvider } from '@multiversx/sdk-dapp/out/providers/helpers/accountProvider';
import { setAccount } from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import { loginAction } from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import { getAccount } from '@multiversx/sdk-dapp/out/methods/account/getAccount';
import { signAndSendTransactions } from 'helpers/signAndSendTransactions';
import { buildSign } from 'multisig/legacyCalls';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const SAFE = 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
const CHAIN_NONCE = 10;

// What the chain answers for alice: it never advances, because nothing was sent.
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

// The network: the first POST fails the way the public API does under load,
// every later one is accepted.
// Nonces are kept as strings: jest-worker cannot serialise a BigInt in a failure message.
const network = { failNext: true, sent: [] as string[] };
jest.mock('@multiversx/sdk-dapp/out/managers/TransactionManager', () => ({
  TransactionManager: {
    getInstance: () => ({
      send: async (transactions: Transaction[]) => {
        if (network.failNext) {
          network.failNext = false;
          throw new Error('Request failed with status code 429');
        }
        network.sent.push(...transactions.map((transaction) => String(transaction.nonce)));
        return transactions;
      },
      track: async () => 'session'
    })
  }
}));

// The wallet: signs whatever it is given and remembers the nonces it was asked to sign.
const wallet = { asked: [] as string[] };
const rawProvider = {
  init: async () => true,
  isInitialized: () => true,
  getType: () => 'extension',
  getAddress: async () => ALICE,
  signTransactions: async (transactions: Transaction[]) => {
    wallet.asked.push(...transactions.map((transaction) => String(transaction.nonce)));
    for (const transaction of transactions) transaction.signature = new Uint8Array(64);
    return transactions;
  }
};

const fromTheChain = () => ({ chainId: 'D', sender: ALICE, nonce: CHAIN_NONCE, safe: SAFE });

beforeAll(() => {
  loginAction({ address: ALICE, providerType: 'extension' } as any);
  setAccount({ address: ALICE, nonce: CHAIN_NONCE, balance: '1946050635000000000', isGuarded: false } as any);
  setAccountProvider(new DappProvider(rawProvider as any));
});

describe('TX-08: a failed send does not push every later transaction one nonce ahead', () => {
  test('the first send fails after the wallet signed nonce 10', async () => {
    const first = await buildSign(fromTheChain(), 7);
    await expect(signAndSendTransactions({ transactions: [first] })).rejects.toThrow('429');
    expect(wallet.asked).toEqual(['10']);
    expect(network.sent).toEqual([]);
  });

  test('sdk-dapp still believes the account is at nonce 10, like the chain', () => {
    expect(getAccount().nonce).toBe(CHAIN_NONCE);
  });

  test('the next transaction is signed with the chain nonce, 10, not 11', async () => {
    // The app reads the nonce from the chain again (contextOf does), so it is 10.
    const second = await buildSign(fromTheChain(), 8);
    await signAndSendTransactions({ transactions: [second] });
    expect(wallet.asked[1]).toBe('10');
    expect(network.sent).toEqual(['10']);
  });
});
