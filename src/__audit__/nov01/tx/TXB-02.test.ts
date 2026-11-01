// TXB-02: what the wallet hands back is sent as it is, without being compared
// with what the app built.
//
// The app builds a transaction (receiver: the safe; data: sign@07, a proposal,
// a perform; value 0; the network's chain id), gives it to the wallet through
// sdk-dapp, and sends whatever array comes back (helpers/signAndSendTransactions:
// signOnly, then sendSigned). Between the two, the transactions travel: to a
// browser extension and back, to a wallet page in another window and back
// (the web wallet, and the guardian's two-factor page for EVERY wallet of a
// guarded signer: sdk-dapp's guardTransactions replaces the array with what
// that window returns), or over a WalletConnect relay. sdk-dapp rebuilds them
// from plain objects and checks nothing. The only field the app checks after
// signing is the nonce of a deploy (signAt, TXN-01).
//
// So a transport that returns a different, validly signed transaction (one the
// signer approved earlier for another purpose, or the same one with other
// fields where the signer's wallet rewrote them) is sent and tracked as if it
// were the one built: the page then reads the wrong safe, saves a wrong address,
// and the toast says the intended action was done.
//
// Correct behaviour: a signed transaction whose sender, receiver, value, data
// or chain id differs from what was built is refused and nothing is sent.
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
const BOB = 'erd1cus9zpgyg8ztpvr48j8w8lqack3u7gtlnxlum22cdl0k0vfwm3eq54npug';
const SAFE = 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
const OTHER_SAFE =
  'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const CHAIN_NONCE = 10;
/** The guardian the API says the signer has. Named so a mock may use it. */
const guardian = { of: '' };

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
  api: async () =>
    guardian.of
      ? { isGuarded: true, activeGuardianAddress: guardian.of }
      : { isGuarded: false },
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
  getType: () => 'extension',
  getAddress: async () => ALICE,
  signTransactions: async (transactions: Transaction[]) => {
    const returned = wallet.rewrite(transactions);
    for (const transaction of returned)
      transaction.signature = new Uint8Array(64);
    return returned;
  }
};

/** The given transaction with some fields replaced, as a transport could. */
const altered = (given: Transaction, changes: Record<string, unknown>) =>
  Transaction.newFromPlainObject({
    ...given.toPlainObject(),
    ...changes
  });

const alice = { address: ALICE, nonce: CHAIN_NONCE };

beforeAll(() => {
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
  wallet.rewrite = (given) => given;
  setAccountNonce(CHAIN_NONCE);
});

test('control: the wallet returns what it was given, and that is sent', async () => {
  await signAction(alice, SAFE, 7);
  expect(network.sent).toHaveLength(1);
  expect(network.sent[0].receiver.toBech32()).toBe(SAFE);
  expect(Buffer.from(network.sent[0].data).toString()).toBe('sign@07');
});

const swaps: [string, Record<string, unknown>][] = [
  ['the receiver is another safe', { receiver: OTHER_SAFE }],
  [
    'the data is another action',
    { data: Buffer.from('sign@08').toString('base64') }
  ],
  [
    'the data is a perform instead of a signature',
    { data: Buffer.from('performAction@07').toString('base64') }
  ],
  ['the value is no longer zero', { value: '1000000000000000000' }],
  ['the chain id is another network', { chainID: '1' }],
  ['the sender is another account', { sender: BOB }]
];

test.each(swaps)(
  'the wallet returns a transaction where %s: nothing is sent',
  async (_what, changes) => {
    wallet.rewrite = ([given]) => [altered(given, changes)];
    await expect(signAction(alice, SAFE, 7)).rejects.toThrow();
    expect(network.sent).toEqual([]);
  }
);

test('the wallet returns nothing: nothing is sent, and the reason is the real one', async () => {
  wallet.rewrite = () => [];
  await expect(signAction(alice, SAFE, 7)).rejects.toThrow(/number of them/);
  expect(network.sent).toEqual([]);
});

test('the nonce goes back after a refused result', async () => {
  wallet.rewrite = ([given]) => [altered(given, { receiver: OTHER_SAFE })];
  await expect(signAction(alice, SAFE, 7)).rejects.toThrow(/receiver differs/);
  expect(getAccount().nonce).toBe(CHAIN_NONCE);
});

test('control: a nonce, gas price and version the wallet changed are the wallet doing its work', async () => {
  wallet.rewrite = ([given]) => [
    altered(given, { nonce: CHAIN_NONCE + 5, gasPrice: 2000000000, version: 2 })
  ];
  await signAction(alice, SAFE, 7);
  expect(network.sent).toHaveLength(1);
  expect(Number(network.sent[0].nonce)).toBe(CHAIN_NONCE + 5);
});

test('control: a guardian and its co-signature added on the way are sent', async () => {
  wallet.rewrite = ([given]) => [
    altered(given, {
      guardian: BOB,
      guardianSignature: 'aa'.repeat(64),
      version: 2,
      options: 2
    })
  ];
  await signAction(alice, SAFE, 7);
  expect(network.sent).toHaveLength(1);
  expect(network.sent[0].guardian.toBech32()).toBe(BOB);
});

describe('an account with a guardian', () => {
  beforeEach(() => {
    guardian.of = BOB;
  });
  afterEach(() => {
    guardian.of = '';
  });

  test('control: the guardian that was built, co-signed', async () => {
    wallet.rewrite = ([given]) => [
      altered(given, { guardianSignature: 'aa'.repeat(64) })
    ];
    await signAction(alice, SAFE, 7);
    expect(network.sent).toHaveLength(1);
    expect(network.sent[0].guardian.toBech32()).toBe(BOB);
  });

  test('another guardian: nothing is sent', async () => {
    wallet.rewrite = ([given]) => [
      altered(given, { guardian: ALICE, guardianSignature: 'aa'.repeat(64) })
    ];
    await expect(signAction(alice, SAFE, 7)).rejects.toThrow(
      /guardian differs/
    );
    expect(network.sent).toEqual([]);
  });
});

test('the wallet returns one transaction more than it was given: nothing is sent', async () => {
  wallet.rewrite = ([given]) => [
    given,
    altered(given, {
      nonce: CHAIN_NONCE + 1,
      data: Buffer.from('performAction@07').toString('base64')
    })
  ];
  await expect(signAction(alice, SAFE, 7)).rejects.toThrow();
  expect(network.sent).toEqual([]);
});
