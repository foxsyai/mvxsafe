/**
 * WEB-10: worthRetrying() decides whether to retry by searching the error text
 * for "429", "502", "503", "504", "timeout" or "Network". api() builds that text
 * as `${path} answered ${status}`, so the request PATH is searched too. An
 * address that happens to contain one of those digit runs turns every refusal
 * (a 404 for an account that does not exist, a 400) into four attempts with
 * 0.6 s + 1.2 s + 2.4 s of waiting. The same test string also misses Chrome's
 * "Failed to fetch", so a dropped connection is retried on Firefox and not on Chrome.
 *
 * Run, from the repository root: npx jest src/__audit__/web/WEB-10.test.ts
 */
jest.useFakeTimers();

type Network = typeof import('multisig/network');

const freshNetwork = (): Network => {
  let network!: Network;
  jest.isolateModules(() => {
    network = require('multisig/network');
  });
  return network;
};

const answer = (status: number) => async () => ({ ok: status < 400, status, json: async () => ({}) });

// A syntactically plausible address with "502" inside it.
const WITH_502 = 'erd1qqqqqqqqqqqqqpgq502haq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p';

test('a 404 is not retried just because the address contains "502"', async () => {
  const fetchMock = jest.fn(answer(404));
  (global as any).fetch = fetchMock;
  const { api } = freshNetwork();

  const outcome = api(`/accounts/${WITH_502}`).catch((error: Error) => error);
  await jest.advanceTimersByTimeAsync(30_000);
  const error = (await outcome) as Error;

  expect(error.message).toContain('404');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('a real 429 is still retried (the behaviour worth keeping)', async () => {
  const fetchMock = jest.fn(answer(429));
  (global as any).fetch = fetchMock;
  const { api } = freshNetwork();

  const outcome = api('/accounts/erd1plain').catch((error: Error) => error);
  await jest.advanceTimersByTimeAsync(30_000);
  await outcome;

  expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
});

// A module, so its top-level names do not collide with other test files.
export {};
