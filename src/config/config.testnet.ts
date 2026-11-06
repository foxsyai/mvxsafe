import { EnvironmentsEnum } from 'lib/sdkDapp/sdkDapp.types';

export * from './sharedConfig';

export const API_URL = 'https://testnet-template-api.multiversx.com';
export const contractAddress =
  'erd1qqqqqqqqqqqqqpgq8tq5rulzxzje29v8kzmcxx9pgx6kmevmep6qckwthl';
export const environment = EnvironmentsEnum.testnet;
// The host the API names at /websocket/config, which the site's content policy
// admits. Given here, sdk-dapp opens it without asking: when that one request
// failed, a signed-in visitor got a blank page (6 Nov 2026).
export const websocketUrl = 'wss://testnet-socket-api.multiversx.com';
