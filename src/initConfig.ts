import './styles/tailwind.css';
import './styles/style.css';

import { config as fontAwesomeConfig } from '@fortawesome/fontawesome-svg-core';
import { environment, walletConnectV2ProjectId } from 'config';
import { InitAppType } from './lib';

fontAwesomeConfig.autoAddCss = false;

// The template also registered an "In Memory Provider", which asks for a
// private key in the browser. A multisig interface must never offer that, so it
// is gone along with its login modal.

export const config: InitAppType = {
  storage: { getStorageCallback: () => sessionStorage },
  dAppConfig: {
    nativeAuth: false,
    environment: environment,
    theme: 'mvx:dark-theme',
    providers: {
      walletConnect: {
        walletConnectV2ProjectId
      }
    }
  }

  // Option 2: Add providers using the config `customProviders` array
  // customProviders: [providers]
};
