// SNP-01: a gas price far above what was built is sent as it is.
//
// signOnly (helpers/signAndSendTransactions) pins the sender, receiver, value,
// data, chain id and guardian of what a wallet hands back, and refuses a lower
// gas limit. The gas price it does not look at. On the MetaMask path three
// hands lie between the app and the key: sdk-dapp's Confirm panel, the Snap's
// page (an iframe from the network's Snap origin, which passes transactions
// through unchanged) and MetaMask's Snap, which signs exactly what that page
// gives it and shows the price only as a fee line that signers are told is an
// upper limit far above the charge. So a page that rewrote the price (whoever
// controls that origin, or a path to it) is signed through MetaMask and sent
// through the app. The network charges the price times the gas it counts, and
// the sender must hold gas limit times price: a thousandfold price turns the
// 0.0001 EGLD a signature cost on 5 Nov 2026 into 0.1 EGLD, with the signer's
// balance as the only ceiling. The same holds for every wallet.
//
// Correct behaviour: a gas price far above what was built is refused and
// nothing is sent, the nonce goes back; the panel's own options, up to a tenth
// more than the standard price, still pass.
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
const rawProvider = {
  init: async () => true,
  isInitialized: () => true,
  getType: () => 'metamask',
  getAddress: async () => ALICE,
  signTransactions: async (transactions: Transaction[]) => {
    const returned = wallet.rewrite(transactions);
    for (const transaction of returned)
      transaction.signature = new Uint8Array(64);
    return returned;
  }
};

/** The given transaction with its gas price replaced, as a page on the way could. */
const atPrice = (given: Transaction, times: number) =>
  Transaction.newFromPlainObject({
    ...given.toPlainObject(),
    gasPrice: Math.round(Number(given.gasPrice) * times)
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
  wallet.rewrite = (given) => given;
  setAccountNonce(CHAIN_NONCE);
});

test('control: the price that was built comes back, and that is sent', async () => {
  await signAction(alice, SAFE, 7);
  expect(network.sent).toHaveLength(1);
  expect(Number(network.sent[0].gasPrice)).toBe(1000000000);
});

test("control: the panel's Faster option, a tenth more, is the wallet doing its work", async () => {
  wallet.rewrite = ([given]) => [atPrice(given, 1.1)];
  await signAction(alice, SAFE, 7);
  expect(network.sent).toHaveLength(1);
  expect(Number(network.sent[0].gasPrice)).toBe(1100000000);
});

test('a thousandfold gas price: nothing is sent, and the nonce goes back', async () => {
  wallet.rewrite = ([given]) => [atPrice(given, 1000)];
  await expect(signAction(alice, SAFE, 7)).rejects.toThrow(/gas/i);
  expect(network.sent).toEqual([]);
  expect(getAccount().nonce).toBe(CHAIN_NONCE);
});
