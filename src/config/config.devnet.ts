import { EnvironmentsEnum } from 'lib/sdkDapp/sdkDapp.types';

export * from './sharedConfig';

export const API_URL = 'https://devnet-template-api.multiversx.com';
export const contractAddress =
  'erd1qqqqqqqqqqqqqpgqm6ad6xrsjvxlcdcffqe8w58trpec09ug9l5qde96pq';
export const environment = EnvironmentsEnum.devnet;
// The host the API names at /websocket/config, which the site's content policy
// admits. Given here, sdk-dapp opens it without asking: when that one request
// failed, a signed-in visitor got a blank page (6 Nov 2026).
export const websocketUrl = 'wss://devnet-socket-api.multiversx.com';
