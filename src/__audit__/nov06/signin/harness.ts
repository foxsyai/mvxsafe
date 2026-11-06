// Sign-in audit harness (6 Nov 2026): a wallet that answers the login the way
// a test says, run through sdk-dapp's REAL login path (native auth on, as in
// dAppConfig). The test file installs the network mocks; see SIN-01.test.tsx.
import {
  Address,
  Message,
  MessageComputer,
  UserSecretKey,
  UserSigner,
  UserVerifier
} from '@multiversx/sdk-core';
import { DappProvider } from '@multiversx/sdk-dapp/out/providers/DappProvider/DappProvider';
import { setAccountProvider } from '@multiversx/sdk-dapp/out/providers/helpers/accountProvider';
import { BaseProviderStrategy } from '@multiversx/sdk-dapp/out/providers/strategies/BaseProviderStrategy/BaseProviderStrategy';
import { ProviderTypeEnum } from '@multiversx/sdk-dapp/out/providers/types/providerFactory.types';
import { getDefaultNativeAuthConfig } from '@multiversx/sdk-dapp/out/services/nativeAuth/methods/getDefaultNativeAuthConfig';
import { setNativeAuthConfig } from '@multiversx/sdk-dapp/out/store/actions/config/configActions';
import { initializeNetwork } from '@multiversx/sdk-dapp/out/store/actions/network/initializeNetwork';
import { initStore } from '@multiversx/sdk-dapp/out/store/store';
import { dAppConfig } from 'dAppConfig';

/** What a wallet may put in its login answer (sdk-dapp's IProvider.login). */
export type LoginAnswer = {
  address: string;
  signature: string;
  multisig?: string;
  impersonate?: string;
  accessToken?: string;
};

/** A key the test holds, standing in for the signer's wallet. */
export const newKey = () => {
  const secret = UserSecretKey.generate();
  return {
    secret,
    address: secret.generatePublicKey().toAddress().toBech32()
  };
};

/**
 * The signature native auth asks a wallet for: the message `address + token`
 * signed the MultiversX way (what @multiversx/sdk-native-auth-server checks).
 */
export const signLoginToken = async (
  secret: UserSecretKey,
  address: string,
  token: string
) => {
  const message = new Message({
    data: Buffer.from(`${address}${token}`),
    address: new Address(address)
  });
  const bytes = new MessageComputer().computeBytesForSigning(message);
  return Buffer.from(await new UserSigner(secret).sign(bytes)).toString('hex');
};

/** Does `signature` prove that the holder of `address` signed `token`? */
export const loginSignatureIsValid = async (
  address: string,
  token: string,
  signature: string
) => {
  try {
    const message = new Message({
      data: Buffer.from(`${address}${token}`),
      address: new Address(address)
    });
    const bytes = new MessageComputer().computeBytesForVerifying(message);
    return await UserVerifier.fromAddress(new Address(address)).verify(
      bytes,
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
};

/**
 * A wallet strategy as sdk-dapp wraps every real one (BaseProviderStrategy),
 * whose answer to the login request is whatever the test decides. It records
 * the token it was asked to sign, so a test can sign it for real.
 */
export class WalletUnderTest extends BaseProviderStrategy<'metamask'> {
  public tokenAsked = '';
  public loggedOut = 0;
  /** Signs what it is given and returns it as it was, like a real wallet. */
  public signsAsGiven = false;

  constructor(
    private readonly answer: (token: string) => Promise<LoginAnswer>
  ) {
    super();
    this._login = async (options) => {
      this.tokenAsked = options?.token ?? '';
      return (await this.answer(this.tokenAsked)) as any;
    };
  }

  async init() {
    return true;
  }
  async logout() {
    this.loggedOut += 1;
    return true;
  }
  getType() {
    return ProviderTypeEnum.metamask;
  }
  async getAddress() {
    return this.address;
  }
  setAccount(account: { address: string }) {
    this.address = account.address;
  }
  isInitialized() {
    return true;
  }
  async signTransactions(transactions: any[]) {
    return this.signsAsGiven ? transactions : [];
  }
  async signMessage() {
    return null;
  }
}

/**
 * What ProviderFactory.create does once the strategy exists: wrap it in the
 * real DappProvider and make it the account provider.
 */
export const asAccountProvider = async (wallet: WalletUnderTest) => {
  await wallet.init();
  const provider = new DappProvider(wallet as any);
  setAccountProvider(provider);
  return provider;
};

/**
 * The store as initApp leaves it for this app: in sessionStorage, the devnet
 * network, native auth on with sdk-dapp's defaults (dAppConfig.nativeAuth).
 */
export const freshSession = async () => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  initStore(() => window.sessionStorage);
  const { apiAddress } = await initializeNetwork({
    customNetworkConfig: dAppConfig.network,
    environment: 'devnet'
  } as any);
  expect(dAppConfig.nativeAuth).toBe(true);
  setNativeAuthConfig(getDefaultNativeAuthConfig({ apiAddress }));
};

/** A block the API would have answered with, for the login token. */
export const blockForTheToken = () => ({
  hash: 'ab'.repeat(32),
  timestamp: Math.floor(Date.now() / 1000) - 12
});

/** An account the API would have answered with, for any address asked. */
export const accountForAnyAddress = ({ address }: { address: string }) => ({
  address,
  nonce: 3,
  balance: '0',
  shard: 1,
  username: '',
  isGuarded: false,
  txCount: 0,
  scrCount: 0
});

/** An address shaped like a contract's: eight zero bytes, then random ones. */
export const newContractAddress = () =>
  new Address(
    Buffer.concat([
      Buffer.alloc(8),
      Buffer.from(UserSecretKey.generate().hex().slice(0, 48), 'hex')
    ])
  ).toBech32();
