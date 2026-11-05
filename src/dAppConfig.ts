import { apiTimeout, environment, walletConnectV2ProjectId } from 'config';
import { InitAppType } from './lib';

// The template also registered an "In Memory Provider", which asks for a
// private key in the browser. A multisig interface must never offer that, so it
// is gone along with its login modal.

export const dAppConfig: InitAppType['dAppConfig'] = {
  // Every wallet signs a login token when connecting: a message for this site,
  // not a transaction. MetaMask's MultiversX Snap logs in with nothing less (it
  // cancelled before MetaMask was asked, devnet, 5 Nov 2026), and the signature
  // proves the address instead of taking the wallet's word for it. sdk-dapp's
  // defaults: the token names this site's origin, lasts 24 hours, and a toast
  // warns 5 minutes before the session ends. It stays in the browser; nothing
  // here sends it anywhere.
  nativeAuth: true,
  environment: environment,
  // Without it sdk-dapp gives every POST 4 s, a 47 KB deploy included (TXB-03).
  network: { apiTimeout: String(apiTimeout) },
  theme: 'mvx:dark-theme',
  providers: {
    walletConnect: {
      walletConnectV2ProjectId
    }
  }
};
