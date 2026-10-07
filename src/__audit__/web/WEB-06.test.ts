/**
 * WEB-06: api() calls fetch with no timeout and no AbortController, while the
 * queue allows six requests in flight. A connection that hangs never settles,
 * so the Safe page stays on "Loading..." forever, and once six reads hang,
 * every later read (including those started by Refresh) queues behind them and
 * never starts. Only a page reload recovers. The SDK provider used for contract
 * queries has a 15 s timeout; the app's own GETs have none.
 *
 * Run: cd /home/sebastian/FOXSY/mvxsafe/app && npx jest src/__audit__/web/WEB-06.test.ts
 */
jest.useFakeTimers();

const hangForever = () => new Promise<Response>(() => undefined);

type Network = typeof import('multisig/network');

const freshNetwork = (): Network => {
  let network!: Network;
  jest.isolateModules(() => {
    network = require('multisig/network');
  });
  return network;
};

beforeEach(() => {
  (global as any).fetch = jest.fn(hangForever);
});

test('a read whose connection hangs settles within two minutes', async () => {
  const { api } = freshNetwork();
  let settled = false;
  api('/accounts/erd1hang').then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await jest.advanceTimersByTimeAsync(120_000);
  expect(settled).toBe(true);
});

test('six hung reads do not stop a later read from ever starting', async () => {
  const { api } = freshNetwork();
  const fetchMock = (global as any).fetch as jest.Mock;
  for (let i = 1; i <= 6; i++) {
    api(`/hung/${i}`).catch(() => undefined);
  }
  await jest.advanceTimersByTimeAsync(1_000);
  api('/accounts/erd1later').catch(() => undefined);
  await jest.advanceTimersByTimeAsync(120_000);

  const started = fetchMock.mock.calls.map(([url]: [string]) => String(url));
  expect(started.some((url) => url.endsWith('/accounts/erd1later'))).toBe(true);
});

// A module, so its top-level names do not collide with other test files.
export {};
