// SIN-01: the login answer is taken at the wallet's word.
//
// Since 5 Nov 2026 every wallet signs a login token when it connects (native
// auth, dAppConfig.nativeAuth). sdk-dapp's login then does two things this app
// never checks: it logs the app in as the `multisig` or `impersonate` address
// the answer names instead of the address that signed (new: without native
// auth those fields were ignored, loginWithoutNativeToken reads getAddress()),
// and it never checks the signature, so any string passes as proof. A wallet
// page that can answer a login (the Snap's page, the web wallet's page, a
// hostile extension) can make mvxsafe show and act as any address it names.
// The app's own comment says the signature "proves the address instead of
// taking the wallet's word for it"; it does not.
//
// Each case runs sdk-dapp's REAL login path with a wallet that answers as the
// test says, then the app's own login handler, exactly as the unlock panel
// does (UnlockPanelManager.handleLogin). A fixed app refuses the session.

jest.mock(
  '@multiversx/sdk-dapp/out/services/nativeAuth/helpers/getLatestBlockHash',
  () => ({
    // The block the API would have answered with, for the login token.
    getLatestBlockHash: async () => ({
      hash: 'ab'.repeat(32),
      timestamp: Math.floor(Date.now() / 1000) - 12
    })
  })
);
jest.mock('@multiversx/sdk-dapp/out/utils/account/fetchAccount', () => ({
  // The API answers for any address asked, as it does for a real one.
  fetchAccount: async ({ address }: { address: string }) => ({
    address,
    nonce: 3,
    balance: '0',
    shard: 1,
    username: '',
    isGuarded: false,
    txCount: 0,
    scrCount: 0
  })
}));
jest.mock(
  '@multiversx/sdk-dapp/out/methods/initApp/websocket/registerWebsocket',
  () => ({
    registerWebsocketListener: async () => undefined,
    websocketManager: { closeConnectionRef: undefined }
  })
);
jest.mock(
  '@multiversx/sdk-dapp/out/methods/trackTransactions/trackTransactions',
  () => ({ trackTransactions: () => undefined })
);
jest.mock(
  '@multiversx/sdk-dapp/out/methods/initApp/gasStationMetadata/setGasStationMetadata',
  () => ({ setGasStationMetadata: async () => undefined })
);
// Should a fix make the app's handler create the provider itself, it gets the
// same wallet under test.
jest.mock('@multiversx/sdk-dapp/out/providers/ProviderFactory', () => ({
  ProviderFactory: {
    customProviders: [],
    create: (options: unknown) => (globalThis as any).__createProvider(options),
    destroy: async () => undefined
  }
}));
jest.mock('lib', () => ({
  getAccountProvider: jest.requireActual(
    '@multiversx/sdk-dapp/out/providers/helpers/accountProvider'
  ).getAccountProvider,
  UnlockPanelManager: {
    init: (options: unknown) => (globalThis as any).__panelInit(options)
  },
  useGetAccount: jest.requireActual(
    '@multiversx/sdk-dapp/out/react/account/useGetAccount'
  ).useGetAccount,
  useGetIsLoggedIn: jest.requireActual(
    '@multiversx/sdk-dapp/out/react/account/useGetIsLoggedIn'
  ).useGetIsLoggedIn,
  useGetLoginInfo: jest.requireActual(
    '@multiversx/sdk-dapp/out/react/loginInfo/useGetLoginInfo'
  ).useGetLoginInfo
}));
jest.mock('multisig/addressBook', () => ({
  getLabel: () => '',
  readHerotag: async () => ''
}));
jest.mock('multisig/network', () => ({
  chainId: 'D',
  forget: () => undefined,
  api: async () => {
    throw new Error('offline');
  },
  networkProvider: {}
}));

import { Address, Transaction } from '@multiversx/sdk-core';
import { LogoutManager } from '@multiversx/sdk-dapp/out/managers/LogoutManager/LogoutManager';
import { getAddress } from '@multiversx/sdk-dapp/out/methods/account/getAddress';
import { getIsLoggedIn } from '@multiversx/sdk-dapp/out/methods/account/getIsLoggedIn';
import { setAccountProvider } from '@multiversx/sdk-dapp/out/providers/helpers/accountProvider';
import { ProviderTypeEnum } from '@multiversx/sdk-dapp/out/providers/types/providerFactory.types';
import { logoutAction } from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConnectButton } from 'components/ConnectButton/ConnectButton';
import { signOnly } from 'helpers/signAndSendTransactions';
import { Unlock } from 'pages/Unlock/Unlock';
import {
  asAccountProvider,
  freshSession,
  LoginAnswer,
  loginSignatureIsValid,
  newContractAddress,
  newKey,
  signLoginToken,
  WalletUnderTest
} from './harness';

type LoginHandler = (...args: unknown[]) => unknown;

const panelInit = jest.fn((_options: { loginHandler: LoginHandler }) => ({
  openUnlockPanel: jest.fn()
}));
(globalThis as any).__panelInit = panelInit;

/** The app's login handler, as it hands it to sdk-dapp's unlock panel. */
const handlerFrom = (entry: 'Connect button' | 'unlock page') => {
  panelInit.mockClear();
  if (entry === 'Connect button') {
    render(<ConnectButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  } else {
    render(
      <MemoryRouter initialEntries={['/unlock']}>
        <Unlock />
      </MemoryRouter>
    );
  }
  expect(panelInit).toHaveBeenCalled();
  const calls = panelInit.mock.calls;
  return calls[calls.length - 1][0].loginHandler;
};

/**
 * What sdk-dapp's panel does once the person picks a wallet
 * (UnlockPanelManager.handleLogin): a plain handler gets the provider created
 * and logged in first; a handler with arguments does it all itself. The panel
 * catches what either throws.
 */
const connect = async (loginHandler: LoginHandler, wallet: WalletUnderTest) => {
  (globalThis as any).__createProvider = () => asAccountProvider(wallet);
  await act(async () => {
    try {
      if (loginHandler.length === 0) {
        const provider = await asAccountProvider(wallet);
        await provider.login();
        await loginHandler();
      } else {
        await loginHandler({ type: ProviderTypeEnum.metamask });
      }
    } catch (error) {
      console.error(error);
    }
  });
};

/** Whom the app now takes the person for. */
const session = () => (getIsLoggedIn() ? getAddress() : 'no session');

/** A wallet whose key is `key`, answering with `extra` on top. */
const walletWith = (
  key: ReturnType<typeof newKey>,
  extra: Partial<LoginAnswer> = {},
  signer = key.secret
) =>
  new WalletUnderTest(async (token) => ({
    address: key.address,
    signature: await signLoginToken(signer, key.address, token),
    ...extra
  }));

beforeAll(async () => {
  // jsdom has no canvas; the header measures the address with one.
  HTMLCanvasElement.prototype.getContext = (() => null) as any;
  await freshSession();
});

afterEach(() => {
  LogoutManager.getInstance().stop();
  cleanup();
  logoutAction();
  setAccountProvider(null as any);
});

describe.each(['Connect button', 'unlock page'] as const)(
  'connecting through the %s',
  (entry) => {
    it('control: an answer signed by the key it names logs that key in', async () => {
      const key = newKey();
      const wallet = walletWith(key);
      await connect(handlerFrom(entry), wallet);
      expect(wallet.tokenAsked).not.toBe('');
      expect(
        await loginSignatureIsValid(
          key.address,
          wallet.tokenAsked,
          await signLoginToken(key.secret, key.address, wallet.tokenAsked)
        )
      ).toBe(true);
      expect(session()).toBe(key.address);
    });

    it('an answer that names another address as `impersonate` must not make the app that address', async () => {
      const key = newKey();
      const other = newKey();
      await connect(
        handlerFrom(entry),
        walletWith(key, { impersonate: other.address })
      );
      // Refused, or the key that signed: never the address the wallet named.
      expect([key.address, 'no session']).toContain(session());
    });

    it('an answer that names a contract as `multisig` must not make the app that contract', async () => {
      const key = newKey();
      const safe = newContractAddress();
      await connect(handlerFrom(entry), walletWith(key, { multisig: safe }));
      expect([key.address, 'no session']).toContain(session());
    });

    it('an answer whose signature is not by the key it names must not log in', async () => {
      const key = newKey();
      const forger = newKey();
      const wallet = walletWith(key, {}, forger.secret);
      await connect(handlerFrom(entry), wallet);
      expect(
        await loginSignatureIsValid(
          key.address,
          wallet.tokenAsked,
          await signLoginToken(forger.secret, key.address, wallet.tokenAsked)
        )
      ).toBe(false);
      expect(session()).toBe('no session');
    });

    it('and after such an answer, nothing is signed for the address the wallet named', async () => {
      // signOnly compares what comes back with what was built, and what was
      // built carries the session's address as sender. So it cannot tell an
      // impersonated session from a real one: the wallet returns the
      // transaction as given and it goes out (the chain refuses the signature,
      // or a wallet that fixes the sender is caught). Either gate serves: a
      // login that refuses the answer, or a sign that refuses the session.
      const key = newKey();
      const other = newKey();
      const wallet = walletWith(key, { impersonate: other.address });
      wallet.signsAsGiven = true;
      await connect(handlerFrom(entry), wallet);
      if (session() !== other.address) return; // refused at the door
      const transaction = new Transaction({
        sender: new Address(other.address),
        receiver: new Address(newContractAddress()),
        value: 0n,
        data: Buffer.from('sign@0a'),
        chainID: 'D',
        gasLimit: 10_000_000n,
        nonce: 3n
      });
      await expect(signOnly([transaction])).rejects.toThrow();
    });
  }
);
