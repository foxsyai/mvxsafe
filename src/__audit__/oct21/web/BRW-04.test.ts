/**
 * BRW-04: the labels in an import file are not bounded, and every label lookup
 * parses and re-checks the whole stored set.
 *
 * importSafes caps the SAFES at MAX_SAFES (WEB-09, 7 Oct 2026) but merges every
 * label the file carries. getLabel() then reads localStorage, JSON.parses it
 * and runs safeLabel (NFKC, three regexes, a split) over every entry, on every
 * call: once per AddressLine at mount, again for each of them on every
 * `mvxsafe:labels` event, and for the header's AccountName. One file with
 * 40,000 labels (about 3 MB, which fits the storage quota) makes each lookup
 * take about 70 ms on this machine, so a safe page with thirty address lines
 * freezes for seconds, on every visit, until the visitor clears the browser's
 * storage by hand: nothing in the app removes labels in bulk.
 *
 * Run, from the app folder: npx jest src/__audit__/oct21/web/BRW-04.test.ts
 */
import { getLabel } from 'multisig/addressBook';
import { importSafes } from 'multisig/savedSafes';

// Addresses that pass the labels' pattern check; no checksum is needed there.
const chars = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
let seed = 2463534242;
const random = () => {
  // xorshift32, deterministic so the file is the same on every run; the top
  // five bits are taken, since the low bits of a simple generator repeat.
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed >>> 27;
};
const fakeAddress = () =>
  'erd1' + Array.from({ length: 58 }, () => chars[random()]).join('');

const fileWithLabels = (count: number) => {
  const labels: Record<string, string> = {};
  for (let at = 0; at < count; at++) labels[fakeAddress()] = `name ${at}`;
  return JSON.stringify({ app: 'mvxsafe', safes: [], labels });
};

const LOOKED_UP = 'erd1' + 'q'.repeat(58);

/** The median of five lookups, in milliseconds. */
const lookupMs = () => {
  const times: number[] = [];
  for (let round = 0; round < 5; round++) {
    const started = performance.now();
    getLabel(LOOKED_UP);
    times.push(performance.now() - started);
  }
  return times.sort((a, b) => a - b)[2];
};

beforeEach(() => {
  window.localStorage.clear();
});

test('control: after a small import a label lookup is instant', () => {
  importSafes(fileWithLabels(50));
  const ms = lookupMs();
  console.log(`50 labels: a lookup takes ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(15);
});

test('after importing a file with 40,000 labels, a label lookup still takes under 15 ms', () => {
  importSafes(fileWithLabels(40_000));
  const stored = window.localStorage.getItem('mvxsafe.labels') ?? '';
  const count = Object.keys(JSON.parse(stored)).length;
  const ms = lookupMs();
  console.log(
    `${count} labels stored (${(stored.length / 1e6).toFixed(2)} MB): a lookup takes ${ms.toFixed(1)} ms`
  );
  // The file really did fill the store (otherwise the test proves nothing).
  expect(count).toBeGreaterThan(39_000);
  expect(ms).toBeLessThan(15);
});
