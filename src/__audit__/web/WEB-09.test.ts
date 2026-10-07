/**
 * WEB-09: importSafes re-reads and re-writes the whole stored list for every
 * entry (getAllSafes + addSafe per entry, each a JSON.parse and a
 * JSON.stringify of everything so far), synchronously on the main thread. The
 * cost is quadratic in the size of the file: measured here, 1,000 entries take
 * 0.3 s, 3,000 take 3 s, 6,000 take 13 s. A file that fills the 5 MB storage
 * quota (about 50,000 entries) freezes the tab for a quarter of an hour.
 *
 * Run: cd /home/sebastian/FOXSY/mvxsafe/app && npx jest src/__audit__/web/WEB-09.test.ts
 */
import { getAllSafes, importSafes } from 'multisig/savedSafes';

// Distinct strings that pass the app's address check. They need not be real.
const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const lookalike = (i: number) => {
  let body = '';
  let n = i;
  for (let k = 0; k < 58; k++) {
    body += alphabet[(n + k * 7) % 32];
    n = Math.floor(n / 32) + k;
  }
  return 'erd1' + body;
};

beforeEach(() => window.localStorage.clear());

test('a file with 6,000 safes imports in under three seconds', () => {
  const file = JSON.stringify({
    app: 'mvxsafe',
    safes: Array.from({ length: 6000 }, (_, i) => ({ name: `Safe ${i}`, address: lookalike(i) }))
  });
  const started = Date.now();
  const result = importSafes(file);
  const elapsed = Date.now() - started;
  // eslint-disable-next-line no-console
  console.log(`6000 entries: added=${result.added} skipped=${result.skipped} stored=${getAllSafes().length} elapsed=${elapsed} ms`);
  expect(elapsed).toBeLessThan(3000);
}, 120_000);
