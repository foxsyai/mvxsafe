/**
 * @jest-environment node
 */
// Open point 3 of the audit of 21 Oct 2026, proven by the main session: the
// guardian is read through the app's request cache, kept 120 s. An account
// guarded in another app (the web wallet's GuardAccount) a moment after this
// page read it is still sent unguarded for up to two minutes. The network
// will not even simulate a guarded account's transaction without its
// guardian, so the page says the network refused a valid action. The reverse,
// a guardian just removed, sends a guarded transaction the account no longer
// has.
//
// Correct behaviour: every send reads the guardian afresh.
jest.mock('helpers/signAndSendTransactions', () => ({
  nonceToSign: (nonce: number) => nonce,
  signAndSendTransactions: jest.fn(async () => 'session')
}));
jest.mock('multisig/network', () => ({
  ...jest.requireActual('multisig/network'),
  networkProvider: {
    getAccount: async () => ({ nonce: 5n }),
    estimateTransactionCost: async (transaction: any) => {
      (globalThis as any).__simulatedWith = transaction.guardian.toBech32();
      return { gasLimit: 5000000 };
    }
  }
}));

import { signAction } from 'multisig/actions';

const GUARDIAN =
  'erd13n5qd94ukuu2s2e3dppavdp0v7q89hj0nk9x2tulhlqyu6hcxy9s3xw87f';
const DAVE = 'erd1wdqwnz0kdswj6njp0yzllkd5q4km9ygvtkme4zlg5kn026mdzc0s77fspw';
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const dave = { address: DAVE, nonce: 5 };

// The API: dave's guardian as it is at the moment of each request.
const chain = { guarded: false };
beforeAll(() => {
  (globalThis as any).fetch = async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      /withGuardianInfo/.test(url) && chain.guarded
        ? { isGuarded: true, activeGuardianAddress: GUARDIAN }
        : { isGuarded: false }
  });
});

test('control: an account that is not guarded is simulated with no guardian', async () => {
  chain.guarded = false;
  await signAction(dave, SAFE, 4);
  expect((globalThis as any).__simulatedWith).toBe('');
});

test('guarded a moment later: the next signature names the guardian', async () => {
  chain.guarded = true;
  await signAction(dave, SAFE, 5);
  expect((globalThis as any).__simulatedWith).toBe(GUARDIAN);
});

test('the guardian removed again: the next signature names none', async () => {
  chain.guarded = false;
  await signAction(dave, SAFE, 6);
  expect((globalThis as any).__simulatedWith).toBe('');
});
