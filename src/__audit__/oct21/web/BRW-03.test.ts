/**
 * BRW-03: the request timeout in multisig/network covers the headers only.
 * fetchWithTimeout races fetch() against a 15 s timer and clears the timer as
 * soon as the race settles, that is as soon as the response HEADERS arrive.
 * The body is read afterwards (`await response.json()`) with no timeout and
 * with the abort controller already out of reach. A connection that delivers
 * the headers and then stalls keeps one of the three request slots for ever,
 * and three of them stop every read in the app until the page is reloaded,
 * the same symptom WEB-06 (7 Oct 2026) fixed for the headers.
 *
 * Run, from the app folder: npx jest src/__audit__/oct21/web/BRW-03.test.ts
 */
import { api } from 'multisig/network';

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

/** Headers arrive at once; the body never does. */
const stalledBody = (): FakeResponse => ({
  ok: true,
  status: 200,
  json: () => new Promise(() => undefined)
});

/** A normal answer. */
const answer = (value: unknown): FakeResponse => ({
  ok: true,
  status: 200,
  json: async () => value
});

const originalFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});

/** Two minutes of fake time: four attempts of 15 s plus the waits between them. */
const twoMinutes = () => jest.advanceTimersByTimeAsync(120_000);

const settles = (promise: Promise<unknown>) => {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );
  return () => done;
};

test('control: a connection whose headers never arrive settles within two minutes (WEB-06)', async () => {
  global.fetch = jest.fn(() => new Promise(() => undefined)) as any;
  const done = settles(api('/accounts/headers-never-arrive'));
  await twoMinutes();
  expect(done()).toBe(true);
});

test('a connection whose body never arrives settles within two minutes', async () => {
  global.fetch = jest.fn(async () => stalledBody()) as any;
  const done = settles(api('/accounts/body-never-arrives'));
  await twoMinutes();
  expect(done()).toBe(true);
});

test('three stalled bodies do not stop a later read from ever answering', async () => {
  global.fetch = jest.fn(async (url: string) =>
    /\/economics$/.test(url) ? answer({ price: 1 }) : stalledBody()
  ) as any;
  // Three reads whose bodies stall: as many as the queue runs at once.
  const stalled = [
    api('/accounts/stalled-one'),
    api('/accounts/stalled-two'),
    api('/accounts/stalled-three')
  ].map((promise) => settles(promise));
  // A fourth read that the network answers at once.
  const later = settles(api('/economics'));
  await twoMinutes();
  expect(stalled.map((done) => done())).toEqual([true, true, true]);
  expect(later()).toBe(true);
});
