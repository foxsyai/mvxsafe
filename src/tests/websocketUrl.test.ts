// A signed-in visitor got a blank page whenever the API refused one request
// (6 Nov 2026). initApp waits for sdk-dapp's websocket, and sdk-dapp asks the
// API for the websocket's address first: once, through plain axios, with no
// retry. A 429 or an outage there made it throw, initApp rejected, and the app
// never rendered, nor tracked a transaction. mvxsafe now gives the address in
// its network config, as sdk-dapp allows, and nothing is asked.
//
// sdk-dapp's REAL network and websocket set-up run here; axios (which refuses
// everything) and socket.io's connection are the fakes.
jest.mock('axios', () => {
  const refuse = jest.fn(async () => {
    throw Object.assign(new Error('Request failed with status code 429'), {
      response: { status: 429 }
    });
  });
  const instance = {
    get: refuse,
    post: refuse,
    interceptors: {
      request: { use: () => 0, eject: () => undefined },
      response: { use: () => 0, eject: () => undefined }
    },
    defaults: {}
  };
  return {
    __esModule: true,
    default: { ...instance, create: () => instance },
    ...instance,
    create: () => instance
  };
});
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    onAny: () => undefined,
    on: () => undefined,
    off: () => undefined,
    close: () => undefined,
    disconnect: () => undefined
  }))
}));

import { registerWebsocketListener } from '@multiversx/sdk-dapp/out/methods/initApp/websocket/registerWebsocket';
import { initializeNetwork } from '@multiversx/sdk-dapp/out/store/actions/network/initializeNetwork';
import axios from 'axios';
import * as devnet from 'config/config.devnet';
import * as mainnet from 'config/config.mainnet';
import * as testnet from 'config/config.testnet';
import { dAppConfig } from 'dAppConfig';

// sdk-dapp's own dependency, so it is reached through the mock alone.
const { io } = jest.requireMock<{ io: jest.Mock }>('socket.io-client');

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
afterAll(() => errors.mockRestore());
beforeEach(() => {
  (axios.get as jest.Mock).mockClear();
  io.mockClear();
});

const asked = () =>
  (axios.get as jest.Mock).mock.calls.filter(([url]) =>
    String(url).includes('/websocket/config')
  ).length;

it('without the address, one refused request stops the websocket, and initApp with it', async () => {
  await initializeNetwork({
    customNetworkConfig: { ...dAppConfig.network, websocketUrl: undefined },
    environment: dAppConfig.environment
  });
  await expect(registerWebsocketListener(ALICE)).rejects.toThrow(
    'Can not get websocket url'
  );
  expect(asked()).toBe(1);
});

it('with the address in the config, nothing is asked and the websocket opens', async () => {
  await initializeNetwork({
    customNetworkConfig: dAppConfig.network,
    environment: dAppConfig.environment
  });
  await expect(registerWebsocketListener(ALICE)).resolves.toBeUndefined();
  expect(asked()).toBe(0);
  expect(io.mock.calls[0][0]).toBe(dAppConfig.network?.websocketUrl);
});

it("each network names its own socket host, the one the API names and the site's content policy admits", () => {
  expect(devnet.websocketUrl).toBe('wss://devnet-socket-api.multiversx.com');
  expect(mainnet.websocketUrl).toBe('wss://socket-api-ovh.multiversx.com');
  expect(testnet.websocketUrl).toBe('wss://testnet-socket-api.multiversx.com');
});
