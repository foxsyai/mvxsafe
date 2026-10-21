/**
 * @jest-environment node
 */
// TXN-03 (suspected by the tx auditor, proven here by the main session, 21 Oct
// 2026): when the one read of the guardian fails (a 429 from the public API is
// enough), a guarded wallet's transaction is simulated without its guardian.
// The network will not simulate a guarded account's transaction without it
// ("not allowed to bypass guardian", mainnet, 13 Oct 2026), so the page says
// the network refused a valid action. The session already knows the guardian:
// sdk-dapp read it at login, and adds it itself at signing.
//
// Correct behaviour: when the read fails, the guardian the session knows is
// used.
jest.mock('helpers/signAndSendTransactions', () => ({
  nonceToSign: (nonce: number) => nonce,
  signAndSendTransactions: jest.fn(async () => 'session')
}));
jest.mock('multisig/network', () => ({
  chainId: 'D',
  api: async (path: string) => {
    if (/withGuardianInfo/.test(path) && (globalThis as any).__apiDown) {
      throw new Error('Request failed with status code 429');
    }
    return /withGuardianInfo/.test(path)
      ? {
          isGuarded: true,
          activeGuardianAddress:
            'erd13n5qd94ukuu2s2e3dppavdp0v7q89hj0nk9x2tulhlqyu6hcxy9s3xw87f'
        }
      : {};
  },
  networkProvider: {
    getAccount: async () => ({ nonce: 5n }),
    estimateTransactionCost: async (transaction: any) => {
      (globalThis as any).__simulatedWith = transaction.guardian.toBech32();
      return { gasLimit: 5000000 };
    }
  }
}));

import { setAccount } from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import { loginAction } from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import { signAction } from 'multisig/actions';

const GUARDIAN =
  'erd13n5qd94ukuu2s2e3dppavdp0v7q89hj0nk9x2tulhlqyu6hcxy9s3xw87f';
const DAVE = 'erd1wdqwnz0kdswj6njp0yzllkd5q4km9ygvtkme4zlg5kn026mdzc0s77fspw';
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const dave = { address: DAVE, nonce: 5 };

beforeAll(() => {
  loginAction({ address: DAVE, providerType: 'extension' } as any);
  setAccount({
    address: DAVE,
    nonce: 5,
    balance: '1000000000000000000',
    isGuarded: true,
    activeGuardianAddress: GUARDIAN
  } as any);
});

beforeEach(() => {
  (globalThis as any).__simulatedWith = undefined;
});

test('control: the guardian read answers, and the simulation names the guardian', async () => {
  (globalThis as any).__apiDown = false;
  await signAction(dave, SAFE, 4);
  expect((globalThis as any).__simulatedWith).toBe(GUARDIAN);
});

test('the guardian read fails: the simulation still names the guardian the session knows', async () => {
  (globalThis as any).__apiDown = true;
  await signAction(dave, SAFE, 4);
  expect((globalThis as any).__simulatedWith).toBe(GUARDIAN);
});
