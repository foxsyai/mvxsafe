import {
  Address,
  Message,
  MessageComputer,
  UserSecretKey,
  UserSigner
} from '@multiversx/sdk-core';
import { afterSignIn, signInProblem } from '../provenSignIn';

// The sign-in check (audit of 6 Nov 2026, SIN-01), with the two forms a wallet
// signs: `address + token`, and a Ledger's `address + token + "{}"` (sdk-dapp's
// Ledger login signs the token with "{}" appended, as sdk-native-auth-server
// accepts; review of PR #25). And the session must end even when the wallet's
// own logout fails or never answers.

const session = {
  address: '',
  tokenLogin: null as null | { loginToken: string; signature: string },
  logout: async () => undefined as unknown
};
const logoutAction = jest.fn(() => {
  session.address = '';
  session.tokenLogin = null;
});

jest.mock('lib/sdkDapp/sdkDapp.helpers', () => ({
  getAccount: () => ({ address: session.address }),
  getLoginInfo: () => ({ tokenLogin: session.tokenLogin }),
  getAccountProvider: () => ({ logout: () => session.logout() }),
  logoutAction: () => logoutAction(),
  ToastManager: {
    getInstance: () => ({ createCustomToast: async () => 'toast' })
  }
}));

const TOKEN =
  'bG9jYWxob3N0.f68177510756edce45eca84b94544a6eacdfa36e69dfd3b8f24c4010d1990751.86400.e30';
const key = UserSecretKey.generate();
const ADDRESS = key.generatePublicKey().toAddress().toBech32();

const signed = async (text: string) => {
  const message = new Message({
    address: new Address(ADDRESS),
    data: Buffer.from(text)
  });
  const bytes = new MessageComputer().computeBytesForSigning(message);
  return Buffer.from(await new UserSigner(key).sign(bytes)).toString('hex');
};

const signIn = async (text: string) => {
  session.address = ADDRESS;
  session.tokenLogin = { loginToken: TOKEN, signature: await signed(text) };
};

beforeEach(() => {
  logoutAction.mockClear();
  session.logout = async () => {
    logoutAction();
    return true;
  };
});

test('control: a signature over the address and the token proves the address', async () => {
  await signIn(`${ADDRESS}${TOKEN}`);
  expect(await signInProblem()).toBe('');
});

test("a Ledger's signature, over the token with {} appended, proves the address too", async () => {
  await signIn(`${ADDRESS}${TOKEN}{}`);
  expect(await signInProblem()).toBe('');
});

test('control: a signature over anything else does not', async () => {
  await signIn(`${ADDRESS}${TOKEN}{"x":1}`);
  expect(await signInProblem()).not.toBe('');
});

test('a session the wallet cannot log out of still ends', async () => {
  await signIn('something else');
  session.logout = async () => {
    throw new Error('the wallet did not answer');
  };
  expect(await afterSignIn()).not.toBe('');
  expect(session.address).toBe('');
});

test('a session whose wallet never answers the logout still ends', async () => {
  jest.useFakeTimers({
    doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask']
  });
  try {
    await signIn('something else');
    session.logout = () => new Promise(() => undefined);
    const ended = afterSignIn();
    await jest.advanceTimersByTimeAsync(6000);
    expect(await ended).not.toBe('');
    expect(session.address).toBe('');
  } finally {
    jest.useRealTimers();
  }
});
