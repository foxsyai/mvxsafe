/**
 * BRW-11: the request queue's token bucket (src/multisig/network.ts, refill)
 * paces requests from Date.now() differences. Date.now() is wall-clock time
 * and can go backwards: a manual clock change, or an NTP step on a machine
 * whose clock had drifted ahead. When it does, `(now - lastRefill)` is
 * negative, the bucket goes deeply negative (four tokens per second of the
 * jump) and pump() waits for that debt to refill before any request runs:
 * ten minutes back means about ten minutes with every read in the app
 * stalled, with no message, until a reload. performance.now() is monotonic,
 * and a negative delta can simply be clamped to zero.
 *
 * Run, from the app folder: npx jest src/__audit__/oct21/web/BRW-11.test.ts
 */
const T0 = Date.UTC(2026, 9, 21, 12, 0, 0);

let api: <T>(path: string) => Promise<T>;
const originalFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  // A fresh queue for every test: the bucket is module state.
  jest.resetModules();
  ({ api } = require('multisig/network'));
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ price: 1 })
  })) as any;
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});

const answered = (promise: Promise<unknown>) => {
  let done = false;
  promise.then(() => {
    done = true;
  });
  return () => done;
};

test('control: a read a minute after the previous one answers at once', async () => {
  const first = answered(api('/economics?first'));
  await jest.advanceTimersByTimeAsync(100);
  expect(first()).toBe(true);

  jest.setSystemTime(T0 + 60_000);
  const second = answered(api('/economics?second'));
  await jest.advanceTimersByTimeAsync(5_000);
  expect(second()).toBe(true);
});

test('a system clock set back ten minutes between two reads does not stall the queue', async () => {
  const first = answered(api('/economics?first'));
  await jest.advanceTimersByTimeAsync(100);
  expect(first()).toBe(true);

  jest.setSystemTime(T0 - 600_000);
  const second = answered(api('/economics?second'));
  await jest.advanceTimersByTimeAsync(10_000);
  expect(second()).toBe(true);
});
