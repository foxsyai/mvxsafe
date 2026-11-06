// Sign-in audit, 6 Nov 2026: what held. The sign-in token every wallet now
// signs (dAppConfig.nativeAuth): what it names, where it is kept, who it is
// shown to, and when it goes. All of these pass; they are the evidence behind
// "checked and sound" in the report, and a guard against regressions.

jest.mock(
  '@multiversx/sdk-dapp/out/services/nativeAuth/helpers/getLatestBlockHash',
  () => ({
    getLatestBlockHash: async () => ({
      hash: 'ab'.repeat(32),
      timestamp: Math.floor(Date.now() / 1000) - 12
    })
  })
);
jest.mock('@multiversx/sdk-dapp/out/utils/account/fetchAccount', () => ({
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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LogoutManager } from '@multiversx/sdk-dapp/out/managers/LogoutManager/LogoutManager';
import { getAddress } from '@multiversx/sdk-dapp/out/methods/account/getAddress';
import { getIsLoggedIn } from '@multiversx/sdk-dapp/out/methods/account/getIsLoggedIn';
import {
  getAccountProvider,
  setAccountProvider
} from '@multiversx/sdk-dapp/out/providers/helpers/accountProvider';
import { ProviderTypeEnum } from '@multiversx/sdk-dapp/out/providers/types/providerFactory.types';
import { decodeLoginToken } from '@multiversx/sdk-dapp/out/services/nativeAuth/helpers/decodeLoginToken';
import { decodeNativeAuthToken } from '@multiversx/sdk-dapp/out/services/nativeAuth/helpers/decodeNativeAuthToken';
import { nativeAuth } from '@multiversx/sdk-dapp/out/services/nativeAuth/nativeAuth';
import { setAccount } from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import { setTokenLogin } from '@multiversx/sdk-dapp/out/store/actions/loginInfo/loginInfoActions';
import {
  loginAction,
  logoutAction
} from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import { nativeAuthConfigSelector } from '@multiversx/sdk-dapp/out/store/selectors/configSelectors';
import {
  loginExpiresAtSelector,
  tokenLoginSelector
} from '@multiversx/sdk-dapp/out/store/selectors/loginInfoSelectors';
import { getState } from '@multiversx/sdk-dapp/out/store/store';
import {
  asAccountProvider,
  freshSession,
  newKey,
  signLoginToken,
  WalletUnderTest
} from './harness';

const DAY = 24 * 3600;
const STORE_KEY = 'sdk-dapp-store';

/** Whom the app now takes the person for. */
const session = () => (getIsLoggedIn() ? getAddress() : 'no session');

/** An honest wallet for `key`, logged in through sdk-dapp's real path. */
const connectHonestly = async (key = newKey()) => {
  const wallet = new WalletUnderTest(async (token) => ({
    address: key.address,
    signature: await signLoginToken(key.secret, key.address, token)
  }));
  const provider = await asAccountProvider(wallet);
  await provider.login();
  return { key, wallet, provider };
};

/** Every store in the browser, as text, to look for a value in. */
const everythingStored = () =>
  JSON.stringify({
    session: { ...window.sessionStorage },
    local: { ...window.localStorage }
  });

beforeAll(async () => {
  await freshSession();
});

afterEach(() => {
  LogoutManager.getInstance().stop();
  logoutAction();
  setAccountProvider(null as any);
});

describe('the sign-in token', () => {
  it('names this page, lasts a day, and is the one the app built', async () => {
    const { key, wallet } = await connectHonestly();
    expect(session()).toBe(key.address);
    // The challenge the wallet was asked to sign came from this app: this
    // page's origin, the API's latest block, sdk-dapp's default day.
    const asked = decodeLoginToken(wallet.tokenAsked);
    expect(asked?.origin).toBe(window.location.origin);
    expect(asked?.blockHash).toBe('ab'.repeat(32));
    expect(asked?.ttl).toBe(DAY);
    expect(nativeAuthConfigSelector(getState())?.expirySeconds).toBe(DAY);
    // What is kept is that challenge, signed, for the key that signed it.
    const kept = tokenLoginSelector(getState());
    expect(kept?.loginToken).toBe(wallet.tokenAsked);
    const token = decodeNativeAuthToken(kept?.nativeAuthToken);
    expect(token?.address).toBe(key.address);
    expect(token?.body).toBe(wallet.tokenAsked);
    expect(token?.origin).toBe(window.location.origin);
  });

  it('is kept in this tab only: sessionStorage, never localStorage or the URL', async () => {
    await connectHonestly();
    const kept = tokenLoginSelector(getState());
    expect(kept?.nativeAuthToken).toBeTruthy();
    const token = String(kept?.nativeAuthToken);
    expect(window.sessionStorage.getItem(STORE_KEY)).toContain(token);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(token);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(
      String(kept?.signature)
    );
    expect(window.location.href).not.toContain(kept?.signature ?? '!');
  });

  it('leaves with the session: Disconnect clears it everywhere and tells the wallet', async () => {
    const { wallet } = await connectHonestly();
    const kept = tokenLoginSelector(getState());
    const token = String(kept?.nativeAuthToken);
    const signature = String(kept?.signature);
    await getAccountProvider().logout();
    expect(session()).toBe('no session');
    expect(tokenLoginSelector(getState())).toBeNull();
    expect(everythingStored()).not.toContain(token);
    expect(everythingStored()).not.toContain(signature);
    expect(wallet.loggedOut).toBe(1);
  });

  it('a tab restored with an expired token is logged out at once', async () => {
    const { key, wallet } = await connectHonestly();
    // What sessionStorage would hold two days later: the same token, kept
    // past its day. LogoutManager.init is what initApp runs on a restore.
    const config = nativeAuthConfigSelector(getState());
    const old = await nativeAuth(config ?? undefined).initialize({
      latestBlockInfo: {
        hash: 'ab'.repeat(32),
        timestamp: Math.floor(Date.now() / 1000) - 2 * DAY
      }
    });
    const stale = nativeAuth(config ?? undefined).getToken({
      address: key.address,
      token: old,
      signature: await signLoginToken(key.secret, key.address, old)
    });
    setTokenLogin({ loginToken: old, signature: 'x', nativeAuthToken: stale });
    expect(session()).toBe(key.address);
    await LogoutManager.getInstance().init();
    await new Promise((settle) => setTimeout(settle, 0));
    expect(session()).toBe('no session');
    expect(wallet.loggedOut).toBe(1);
  });

  it('a session from before the change (no token) still ends within a day', async () => {
    // Before 5 Nov 2026 the store held an address and no token. sdk-dapp's
    // logoutMiddleware stamps every session with a 24-hour end regardless.
    const key = newKey();
    const wallet = new WalletUnderTest(async () => ({
      address: key.address,
      signature: ''
    }));
    await asAccountProvider(wallet);
    loginAction({
      address: key.address,
      providerType: ProviderTypeEnum.metamask
    });
    setAccount({ address: key.address, nonce: 0, balance: '0' } as any);
    expect(session()).toBe(key.address);
    expect(tokenLoginSelector(getState())).toBeNull();
    const endsAt = loginExpiresAtSelector(getState());
    expect(endsAt).not.toBeNull();
    expect(Number(endsAt) - Date.now()).toBeLessThanOrEqual(DAY * 1000);
    expect(Number(endsAt) - Date.now()).toBeGreaterThan(DAY * 1000 - 60_000);
    // Nothing native-auth starts for it (no token to time), which is fine:
    // the day above still applies.
    await LogoutManager.getInstance().init();
    expect(session()).toBe(key.address);
  });

  it('is put on no request by this app', () => {
    // sdk-dapp itself reads it only to time the logout (LogoutManager) and
    // in the one helper that would put it on requests, setAxiosInterceptors,
    // which this app no longer calls (PR #24 removed AxiosInterceptors). The
    // app may read the token to check it; it may not hand it on. The shipped
    // src/tests/signIn.test.ts guards the same words.
    const SRC = resolve(process.cwd(), 'src');
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory())
          return ['__audit__', 'tests'].includes(name) ? [] : sources(path);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)
          ? [path]
          : [];
      });
    const handing = sources(SRC).filter((file) =>
      /setAxiosInterceptors|nativeAuthToken|bearerToken|Authorization|Bearer /.test(
        readFileSync(file, 'utf8')
      )
    );
    expect(handing.map((file) => file.slice(SRC.length + 1))).toEqual([]);
  });
});
