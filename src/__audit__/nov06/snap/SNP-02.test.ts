// SNP-02: a nonce other than the one sdk-dapp assigned is sent as it is.
//
// sdk-dapp sets every nonce itself before a wallet is asked (computeNonces, on
// the very objects the app built), so after signing the app knows which nonce
// each transaction was meant to carry. signOnly lets any nonce through. On the
// MetaMask path the Snap's page passes transactions through unchanged and the
// Snap signs what it gets, so a page that rewrote the nonce (whoever controls
// that origin, or a path to it) is signed and sent through, and MetaMask shows
// no nonce a signer could catch. The deploy path already refuses this (signAt,
// tx audit TXN-01), because a new safe's address follows from it; every other
// call does not. One ahead: the transaction waits in the pool, the app moves
// on to the same nonce, and everything the signer tries next from this tab
// collides with it until the page is reloaded and the gap filled. Several
// ahead: a signature or a perform that looks lost runs later, whenever the
// gap is filled, at a moment nobody chose.
//
// Correct behaviour: a signed transaction whose nonce is not the one it was
// given to the wallet with is refused, nothing is sent, the nonce goes back.
//
// The real sdk-dapp DappProvider and store run; the wallet, the network reads
// and the send are fakes. Nothing touches a network.
import { Transaction } from '@multiversx/sdk-core';
import { getAccount } from '@multiversx/sdk-dapp/out/methods/account/getAccount';
import { DappProvider } from '@multiversx/sdk-dapp/out/providers/DappProvider/DappProvider';
import { setAccountProvider } from '@multiversx/sdk-dapp/out/providers/helpers/accountProvider';
import {
  setAccount,
  setAccountNonce
} from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import { loginAction } from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import { signAction } from 'multisig/actions';

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
    estimateTransactionCost: async () => ({ gasLimit: 5000000 })
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

/** What comes back from the wallet, in place of what was given. */
const wallet = {
  rewrite: (given: Transaction[]): Transaction[] => given
};
/** The nonces the wallet was asked to sign at, as sdk-dapp set them. */
const asked: number[] = [];
const rawProvider = {
  init: async () => true,
  isInitialized: () => true,
  getType: () => 'metamask',
  getAddress: async () => ALICE,
  signTransactions: async (transactions: Transaction[]) => {
    asked.push(...transactions.map((transaction) => Number(transaction.nonce)));
    const returned = wallet.rewrite(transactions);
    for (const transaction of returned)
      transaction.signature = new Uint8Array(64);
    return returned;
  }
};

/** The given transaction with its nonce moved, as a page on the way could. */
const atNonce = (given: Transaction, by: number) =>
  Transaction.newFromPlainObject({
    ...given.toPlainObject(),
    nonce: Number(given.nonce) + by
  });

const alice = { address: ALICE, nonce: CHAIN_NONCE };

beforeAll(() => {
  loginAction({ address: ALICE, providerType: 'metamask' } as any);
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
  asked.length = 0;
  wallet.rewrite = (given) => given;
  setAccountNonce(CHAIN_NONCE);
});

test('control: the nonce sdk-dapp assigned comes back, and that is sent', async () => {
  await signAction(alice, SAFE, 7);
  expect(asked).toEqual([CHAIN_NONCE]);
  expect(network.sent).toHaveLength(1);
  expect(Number(network.sent[0].nonce)).toBe(CHAIN_NONCE);
});

test.each([
  ['one ahead', 1],
  ['five ahead', 5]
])(
  'the wallet returns the transaction %s of the nonce it was given: nothing is sent, and the nonce goes back',
  async (_how, by) => {
    wallet.rewrite = ([given]) => [atNonce(given, by)];
    await expect(signAction(alice, SAFE, 7)).rejects.toThrow(/nonce/i);
    expect(asked).toEqual([CHAIN_NONCE]);
    expect(network.sent).toEqual([]);
    expect(getAccount().nonce).toBe(CHAIN_NONCE);
  }
);
