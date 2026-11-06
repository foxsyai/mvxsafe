// The stuck toast (14 Oct 2026, still open after the audit of 21 Oct). sdk-dapp
// settles a transaction's toast from its own reads of /transactions?hashes=,
// outside mvxsafe's paced queue. A refused read is only logged, so a run of
// 429s keeps the toast spinning; and 31 reads that miss the hash mark the
// session timed out for good, even when the transaction then succeeds.
//
// sdk-dapp's REAL tracker and store run here; axios (its reads) and the
// network's answers to mvxsafe are the fakes. Each case first shows sdk-dapp
// alone getting it wrong, then mvxsafe's settler putting the network's answer
// in its place.
jest.mock('axios', () => {
  const get = jest.fn();
  const post = jest.fn();
  const interceptors = {
    request: { use: () => 0, eject: () => undefined },
    response: { use: () => 0, eject: () => undefined }
  };
  const instance = { get, post, interceptors, defaults: {} };
  const create = () => instance;
  return {
    __esModule: true,
    default: { ...instance, create },
    get,
    post,
    create
  };
});
jest.mock('multisig/network', () => ({
  apiFresh: jest.fn(),
  gatewayFresh: jest.fn()
}));

import { registerCallbacks } from '@multiversx/sdk-dapp/out/managers/TransactionManager/helpers/sessionCallbacks';
import { checkTransactionStatus } from '@multiversx/sdk-dapp/out/methods/trackTransactions/helpers/checkTransactionStatus/checkTransactionStatus';
import {
  addTransactionToast,
  removeTransactionToast
} from '@multiversx/sdk-dapp/out/store/actions/toasts/toastsActions';
import {
  createTransactionsSession,
  updateSessionStatus
} from '@multiversx/sdk-dapp/out/store/actions/transactions/transactionsActions';
import { getIsTransactionPending } from '@multiversx/sdk-dapp/out/store/actions/transactions/transactionStateByStatus';
import { getState } from '@multiversx/sdk-dapp/out/store/store';
import { TransactionBatchStatusesEnum } from '@multiversx/sdk-dapp/out/types/enums.types';
import axios from 'axios';
import { apiFresh, gatewayFresh } from 'multisig/network';
import {
  createSettler,
  FIRST_LOOK_MS,
  GIVE_UP_MS,
  LOOK_EVERY_MS,
  NetworkAnswer,
  readTransaction,
  SESSION_MAX_AGE_MS
} from '../settleTrackedTransactions';

const SAFE = 'erd1qqqqqqqqqqqqqpgqvhmkludyju7m9acwpfchadgeux9h0xa2mg8s523mc5';
const SIGNER = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';

// sdk-dapp counts its misses by hash, for the life of the page: every case
// uses hashes of its own.
let lastHash = 0x5afe0000;
const newHash = () => (lastHash++).toString(16).padStart(64, '0');

// Session ids are sdk-dapp's Date.now() at the moment it was created.
let wall = 1_900_000_000_000;
jest.spyOn(Date, 'now').mockImplementation(() => wall);
let clock = 0;

const network = new Map<string, NetworkAnswer | null>();
const read = jest.fn(async (hash: string) => network.get(hash) ?? null);
const soon = jest.fn();

const get = axios.get as jest.Mock;
const refused = () =>
  get.mockRejectedValue(
    Object.assign(new Error('Request failed with status code 429'), {
      response: { status: 429 }
    })
  );
const missing = () => get.mockResolvedValue({ data: [] });

const newSession = (hashes: string[]) => {
  wall += 1000;
  const sessionId = createTransactionsSession({
    transactions: hashes.map((hash, at) => ({
      hash,
      status: 'pending',
      sender: SIGNER,
      receiver: SAFE,
      nonce: 100 + at,
      value: '0',
      gasLimit: 30_000_000,
      gasPrice: 1_000_000_000,
      chainID: 'D',
      version: 2,
      data: ''
    })) as any,
    transactionsDisplayInfo: {
      processingMessage: 'Proposing...',
      errorMessage: 'Proposing failed',
      successMessage: 'Proposing done'
    },
    status: TransactionBatchStatusesEnum.sent
  });
  addTransactionToast({ toastId: sessionId, totalDuration: 6000 });
  const onSuccess = jest.fn(async () => undefined);
  const onFail = jest.fn(async () => undefined);
  registerCallbacks({ sessionId, onSuccess, onFail });
  return { sessionId, onSuccess, onFail };
};

const session = (sessionId: string) => getState().transactions[sessionId];
const statusOf = (sessionId: string) => String(session(sessionId)?.status);
const toastShown = (sessionId: string) =>
  getState().toasts.transactionToasts.some(
    ({ toastId }) => toastId === sessionId
  );

/** sdk-dapp's own poll, as its interval runs it, `times` over. */
const sdkPolls = async (times: number) => {
  for (let at = 0; at < times; at++) await checkTransactionStatus();
};

/** sdk-dapp gives up on the session: 31 reads that do not find the hash. */
const timeOutInSdkDapp = async (sessionId: string) => {
  missing();
  await sdkPolls(32);
  expect(statusOf(sessionId)).toBe('timedOut');
};

let settler: ReturnType<typeof createSettler>;
const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(() => {
  network.clear();
  read.mockClear();
  soon.mockClear();
  get.mockReset();
  clock = 0;
  settler = createSettler({
    read,
    now: () => clock,
    wallNow: () => wall,
    soon
  });
});

afterEach(() => settler.stop());
afterAll(() => errors.mockRestore());

describe('a toast sdk-dapp cannot settle', () => {
  it('is settled from the network when every poll of sdk-dapp is refused (429)', async () => {
    const hash = newHash();
    const { sessionId, onSuccess, onFail } = newSession([hash]);
    refused();
    await sdkPolls(40);
    // sdk-dapp alone: forty refusals later, still spinning.
    expect(statusOf(sessionId)).toBe('sent');

    network.set(hash, { status: 'success' });
    await settler.tick();
    clock += FIRST_LOOK_MS - 1;
    await settler.tick();
    // A session sdk-dapp may still settle itself is left to it at first.
    expect(read).not.toHaveBeenCalled();

    clock += 1;
    await settler.tick();
    expect(read).toHaveBeenCalledWith(hash);
    expect(statusOf(sessionId)).toBe('success');
    expect(session(sessionId).transactions[0].status).toBe('success');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFail).not.toHaveBeenCalled();

    // And sdk-dapp stops asking about it.
    get.mockClear();
    await sdkPolls(3);
    expect(get).not.toHaveBeenCalled();
  });

  it('turns a false "timed out" into the success the network reports', async () => {
    const hash = newHash();
    const { sessionId, onSuccess, onFail } = newSession([hash]);
    await timeOutInSdkDapp(sessionId);
    // sdk-dapp alone: a successful transaction reported as failed.
    expect(onFail).toHaveBeenCalledTimes(1);
    // mvxsafe is told at once, without waiting for its clock.
    expect(soon).toHaveBeenCalled();

    network.set(hash, { status: 'success' });
    await settler.tick();
    expect(statusOf(sessionId)).toBe('success');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(toastShown(sessionId)).toBe(true);
  });

  it('shows the corrected answer again when the timed-out toast has closed', async () => {
    const hash = newHash();
    const { sessionId } = newSession([hash]);
    await timeOutInSdkDapp(sessionId);
    // A finished toast closes itself after five seconds.
    removeTransactionToast(sessionId);

    network.set(hash, { status: 'success' });
    await settler.tick();
    expect(statusOf(sessionId)).toBe('success');
    expect(toastShown(sessionId)).toBe(true);
  });

  it('puts a timed-out transaction the network is still processing back to processing, where sdk-dapp leaves it', async () => {
    const hash = newHash();
    const { sessionId, onSuccess } = newSession([hash]);
    await timeOutInSdkDapp(sessionId);

    network.set(hash, { status: 'pending' });
    await settler.tick();
    expect(getIsTransactionPending(statusOf(sessionId))).toBe(true);

    // sdk-dapp's tracker does not time it out a second time.
    get.mockClear();
    await sdkPolls(5);
    expect(get).not.toHaveBeenCalled();
    expect(getIsTransactionPending(statusOf(sessionId))).toBe(true);

    network.set(hash, { status: 'success' });
    clock += LOOK_EVERY_MS - 1;
    await settler.tick();
    expect(getIsTransactionPending(statusOf(sessionId))).toBe(true);
    clock += 1;
    await settler.tick();
    expect(statusOf(sessionId)).toBe('success');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('fails the toast with the contract’s own message', async () => {
    const hash = newHash();
    const { sessionId, onSuccess, onFail } = newSession([hash]);
    refused();
    await sdkPolls(3);

    network.set(hash, {
      status: 'fail',
      returnMessage: 'action does not exist'
    });
    await settler.tick();
    clock += FIRST_LOOK_MS;
    await settler.tick();
    expect(statusOf(sessionId)).toBe('fail');
    expect(session(sessionId).errorMessage).toBe('action does not exist');
    expect(session(sessionId).transactions[0].status).toBe('fail');
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('settles a batch only once every transaction in it has an answer', async () => {
    const [first, second] = [newHash(), newHash()];
    const { sessionId, onSuccess } = newSession([first, second]);
    refused();

    network.set(first, { status: 'success' });
    network.set(second, { status: 'pending' });
    await settler.tick();
    clock += FIRST_LOOK_MS;
    await settler.tick();
    expect(statusOf(sessionId)).toBe('sent');
    expect(session(sessionId).transactions.map(({ status }) => status)).toEqual(
      ['success', 'pending']
    );

    network.set(second, { status: 'invalid' });
    clock += LOOK_EVERY_MS;
    await settler.tick();
    expect(read).toHaveBeenLastCalledWith(second);
    expect(statusOf(sessionId)).toBe('fail');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('keeps the network’s answer when sdk-dapp’s late check ends in "timed out" after it', async () => {
    const hash = newHash();
    const { sessionId } = newSession([hash]);
    await timeOutInSdkDapp(sessionId);
    network.set(hash, { status: 'success' });
    await settler.tick();
    expect(statusOf(sessionId)).toBe('success');

    // A check sdk-dapp started before the answer came writes its verdict now.
    updateSessionStatus({
      sessionId,
      status: TransactionBatchStatusesEnum.timedOut
    });
    await Promise.resolve();
    expect(statusOf(sessionId)).toBe('success');
  });
});

describe('what the settler leaves alone', () => {
  it('a transaction the network never heard of stays timed out, and is let go after ten minutes', async () => {
    const hash = newHash();
    const { sessionId, onSuccess } = newSession([hash]);
    await timeOutInSdkDapp(sessionId);

    for (let elapsed = 0; elapsed < GIVE_UP_MS; elapsed += LOOK_EVERY_MS) {
      await settler.tick();
      clock += LOOK_EVERY_MS;
    }
    expect(statusOf(sessionId)).toBe('timedOut');
    const asked = read.mock.calls.length;
    expect(asked).toBeGreaterThan(10);

    clock += LOOK_EVERY_MS;
    await settler.tick();
    expect(read.mock.calls.length).toBe(asked);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('a transaction still processing after ten minutes is timed out again, without a second failure callback', async () => {
    const hash = newHash();
    const { sessionId, onFail } = newSession([hash]);
    await timeOutInSdkDapp(sessionId);
    network.set(hash, { status: 'pending' });
    await settler.tick();
    expect(getIsTransactionPending(statusOf(sessionId))).toBe(true);

    for (let elapsed = 0; elapsed <= GIVE_UP_MS; elapsed += LOOK_EVERY_MS) {
      await settler.tick();
      clock += LOOK_EVERY_MS;
    }
    await settler.tick();
    expect(statusOf(sessionId)).toBe('timedOut');
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('a session sdk-dapp settled, one only signed, an old one and one with no hash', async () => {
    const old = newSession([newHash()]);
    wall += SESSION_MAX_AGE_MS;

    const settledHash = newHash();
    const done = newSession([settledHash]);
    updateSessionStatus({
      sessionId: done.sessionId,
      status: TransactionBatchStatusesEnum.success
    });

    const signed = newSession([newHash()]);
    updateSessionStatus({
      sessionId: signed.sessionId,
      status: TransactionBatchStatusesEnum.signed
    });

    const noHash = newSession(['not-a-hash']);

    // And one it does look at, in the same pass.
    const openHash = newHash();
    const open = newSession([openHash]);
    network.set(openHash, { status: 'success' });

    await settler.tick();
    clock += FIRST_LOOK_MS;
    await settler.tick();
    expect(read.mock.calls).toEqual([[openHash]]);
    expect(statusOf(open.sessionId)).toBe('success');
    expect(read).not.toHaveBeenCalledWith(settledHash);
    expect(read.mock.calls.map(([hash]) => hash)).not.toContain(
      session(old.sessionId).transactions[0].hash
    );
    expect(read.mock.calls.map(([hash]) => hash)).not.toContain('not-a-hash');
    expect(statusOf(signed.sessionId)).toBe('signed');
    expect(statusOf(noHash.sessionId)).toBe('sent');
  });
});

describe('readTransaction', () => {
  const index = apiFresh as jest.Mock;
  const nodes = gatewayFresh as jest.Mock;
  const nodesSay = (status: string, reason = '') =>
    nodes.mockResolvedValueOnce({
      code: 'successful',
      data: { status, reason }
    });
  beforeEach(() => {
    index.mockReset();
    nodes.mockReset();
  });

  it("takes the nodes' final answer, through the paced queue and past its cache, without asking the API", async () => {
    const hash = newHash();
    nodesSay('success');
    expect(await readTransaction(hash)).toEqual({ status: 'success' });
    expect(nodes).toHaveBeenCalledWith(`/transaction/${hash}/process-status`);
    expect(index).not.toHaveBeenCalled();
  });

  it("gives a failure the contract's own words, the last part of the nodes' reason", async () => {
    // As devnet's gateway answered for a perform that lacked its quorum.
    nodesSay(
      'fail',
      '\n\truntime.go:896 [error signalled by smartcontract] [performAction]\n\truntime.go:893 [quorum has not been reached]'
    );
    expect(await readTransaction(newHash())).toEqual({
      status: 'fail',
      returnMessage: 'quorum has not been reached'
    });
  });

  it('asks the API when the nodes have no final answer, and takes its own', async () => {
    const hash = newHash();
    nodesSay('pending');
    index.mockResolvedValueOnce({
      txHash: hash,
      status: 'fail',
      results: [
        { returnMessage: '' },
        { returnMessage: 'action does not exist' }
      ]
    });
    expect(await readTransaction(hash)).toEqual({
      status: 'fail',
      returnMessage: 'action does not exist'
    });
    expect(index).toHaveBeenCalledWith(
      `/transactions/${hash}?fields=txHash,status,results`
    );
  });

  it('says pending when either does and neither has more', async () => {
    const hash = newHash();
    nodes.mockRejectedValueOnce(new Error('/transaction answered 500'));
    index.mockResolvedValueOnce({ txHash: hash, status: 'pending' });
    expect(await readTransaction(hash)).toEqual({ status: 'pending' });
  });

  it('takes no answer for one: another hash, an unknown status, a refusal, or a hash that is not one', async () => {
    const hash = newHash();
    nodes.mockResolvedValue({ code: 'internal_issue', data: null });
    index.mockResolvedValueOnce({ txHash: newHash(), status: 'success' });
    expect(await readTransaction(hash)).toBeNull();
    nodes.mockResolvedValueOnce({
      code: 'successful',
      data: { status: 'odd' }
    });
    index.mockResolvedValueOnce({ txHash: hash, status: 'reward-reverted' });
    expect(await readTransaction(hash)).toBeNull();
    nodes.mockRejectedValueOnce(new Error('/transaction answered 500'));
    index.mockRejectedValueOnce(new Error('/transactions answered 404'));
    expect(await readTransaction(hash)).toBeNull();
    expect(await readTransaction('../accounts/erd1')).toBeNull();
    expect(nodes).toHaveBeenCalledTimes(3);
    expect(index).toHaveBeenCalledTimes(3);
  });
});
