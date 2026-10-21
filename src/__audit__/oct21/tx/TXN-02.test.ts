// TXN-02: the two transactions that create a safe are posted to the API as two
// independent, concurrent requests, so when only the handover is refused, the
// safe that the deploy created is lost to the person who paid for it.
//
// createSafe (src/multisig/actions.ts) signs the deploy and the handover
// together and hands both to signAndSendTransactions, which calls sdk-dapp's
// TransactionManager.send. That send POSTs every transaction separately and
// concurrently (Promise.all over axios.post) and rejects as a whole the moment
// any one POST rejects, even though the others were already accepted by the
// network. The app then treats the pair as if nothing was sent: the stored
// nonce is wound back and createSafe rejects, so the Create page saves nothing
// and navigates nowhere. But the deploy's POST was accepted: the safe is
// created, owned by the deployer's wallet (its self-handover never ran), at an
// address the person is never shown. A POST refused with 429 (the public API
// rate-limits per IP, and the two POSTs land right after the page's own burst
// of reads) or a slow upload of the 47 KB deploy that outlives sdk-dapp's
// 4 s client timeout both end here. The next attempt makes a second safe.
//
// Correct behaviour: a safe whose deploy reached the network is never lost to
// the person: createSafe surfaces its address, so the safe page can show it
// with the one-click "hand it to itself" the app already has for a safe that
// is not in its own hands.
//
// The real sdk-dapp TransactionManager, DappProvider, store and nonce logic
// run; only the wallet, the app's own reads and the HTTP layer (axios) are
// fakes. Nothing touches a network.
jest.mock('axios', () => {
  const post = jest.fn();
  const get = jest.fn(async () => ({ data: {} }));
  const interceptors = {
    request: { use: () => 0, eject: () => undefined },
    response: { use: () => 0, eject: () => undefined }
  };
  const instance = { post, get, interceptors, defaults: {} };
  const create = () => instance;
  return {
    __esModule: true,
    default: { ...instance, create },
    post,
    get,
    create
  };
});

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
import axios from 'axios';
import { createSafe } from 'multisig/actions';
import { predictSafeAddress } from 'multisig/legacyCalls';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const CHAIN_NONCE = 10;
// A deploy goes to the system deploy address; that is how its POST is told apart.
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

/** Every POST the send issued: its nonce and receiver, in order. */
const posted: { nonce: number; receiver: string }[] = [];
/** How the API answers the handover's POST: 'accept' or 'refuse'. */
const handover = { answer: 'accept' as 'accept' | 'refuse' };

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
  (axios.post as jest.Mock).mockImplementation(
    async (_url: string, body: { nonce: number; receiver: string }) => {
      posted.push({ nonce: Number(body.nonce), receiver: body.receiver });
      const isDeploy = body.receiver === DEPLOY_RECEIVER;
      if (!isDeploy && handover.answer === 'refuse') {
        throw Object.assign(new Error('Request failed with status code 429'), {
          response: { status: 429, data: { message: 'Too many requests' } }
        });
      }
      return { data: { txHash: `hash-${body.nonce}` } };
    }
  );
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

beforeEach(() => {
  posted.length = 0;
  setAccountNonce(CHAIN_NONCE);
});

const attempt = async () => {
  try {
    return { safe: await createSafe(alice, { quorum: 1, board: [ALICE] }) };
  } catch (failure) {
    return { failure };
  }
};

/** The address of the safe the deploy's POST created, from its real signed nonce. */
const createdByDeploy = () => {
  const deploy = posted.find((p) => p.receiver === DEPLOY_RECEIVER);
  if (!deploy) throw new Error('the deploy was never posted');
  return predictSafeAddress(ALICE, deploy.nonce);
};

/** What the outcome tells the person: the resolved address, or the error's words. */
const named = (outcome: { safe?: string; failure?: unknown }) =>
  outcome.safe ??
  String((outcome.failure as any)?.message ?? outcome.failure ?? '');

describe('TXN-02: a safe whose deploy reached the network is never lost', () => {
  test('control: both POSTs accepted: createSafe resolves to the safe the deploy created, and the handover hands it to itself', async () => {
    handover.answer = 'accept';
    const outcome = await attempt();
    const created = createdByDeploy();
    expect(outcome.safe).toBe(created);
    // The handover's POST targeted that same safe.
    const handoverPost = posted.find((p) => p.receiver !== DEPLOY_RECEIVER);
    expect(handoverPost?.receiver).toBe(created);
  });

  test('the deploy is accepted and the handover is refused: the deploy reached the network but the person is not told the safe exists', async () => {
    handover.answer = 'refuse';
    const outcome = await attempt();
    // The deploy's POST was issued and accepted: the safe will exist.
    const created = createdByDeploy();
    expect(outcome.failure).toBeDefined();
    // The one thing the person must get: the address of the safe that now
    // exists and is still owned by their wallet. Today the error is the bare
    // network message, with no address at all.
    expect(named(outcome)).toContain(created);
  });
});
