import {
  apiTimeout,
  environment,
  walletConnectV2ProjectId,
  websocketUrl
} from 'config';
import { InitAppType } from './lib';

// The template also registered an "In Memory Provider", which asks for a
// private key in the browser. A multisig interface must never offer that, so it
// is gone along with its login modal.

export const dAppConfig: InitAppType['dAppConfig'] = {
  // Every wallet signs a login token when connecting: a message for this site,
  // not a transaction. MetaMask's MultiversX Snap logs in with nothing less (it
  // cancelled before MetaMask was asked, devnet, 5 Nov 2026). sdk-dapp does not
  // check that signature: helpers/provenSignIn does, after every sign-in, and
  // ends a session whose address the signature does not prove (SIN-01). sdk-dapp's
  // defaults: the token names this site's origin, lasts 24 hours, and a toast
  // warns 5 minutes before the session ends. It stays in the browser; nothing
  // here sends it anywhere.
  nativeAuth: true,
  environment: environment,
  // Without it sdk-dapp gives every POST 4 s, a 47 KB deploy included (TXB-03).
  // The websocket's address is given too: sdk-dapp otherwise asks the API for
  // it once, with no retry, and when that answer failed (a 429 or an outage)
  // initApp threw, and a signed-in visitor got a blank page with no transaction
  // tracking at all (6 Nov 2026).
  network: { apiTimeout: String(apiTimeout), websocketUrl },
  theme: 'mvx:dark-theme',
  providers: {
    walletConnect: {
      walletConnectV2ProjectId
    }
  }
};
