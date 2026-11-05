import './styles/tailwind.css';
import './styles/style.css';

import { config as fontAwesomeConfig } from '@fortawesome/fontawesome-svg-core';
import { dAppConfig } from './dAppConfig';
import { InitAppType } from './lib';

fontAwesomeConfig.autoAddCss = false;

export const config: InitAppType = {
  storage: { getStorageCallback: () => sessionStorage },
  dAppConfig
};
