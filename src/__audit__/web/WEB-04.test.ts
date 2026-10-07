/**
 * WEB-04: isValidSafeAddress is /^erd1[0-9a-z]{58}$/. It accepts strings that
 * are not MultiversX addresses: a wrong bech32 checksum (one mistyped
 * character) and characters outside the bech32 alphabet. Such an entry is saved
 * and imported as a safe, and then shows "..." or "could not be read" forever
 * instead of being refused at entry. sdk-core's Address.isValid does the real check.
 *
 * Run: cd /home/sebastian/FOXSY/mvxsafe/app && npx jest src/__audit__/web/WEB-04.test.ts
 */
import { Address } from '@multiversx/sdk-core';
import { importSafes, isValidSafeAddress } from 'multisig/savedSafes';

const TREASURY = 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p';
// The Treasury address with its last character changed: the checksum no longer matches.
const TYPO = TREASURY.slice(0, -1) + 'q';

beforeEach(() => window.localStorage.clear());

test('an address with a wrong checksum is refused', () => {
  expect(Address.isValid(TREASURY)).toBe(true);
  expect(Address.isValid(TYPO)).toBe(false);
  expect(isValidSafeAddress(TYPO)).toBe(false);
});

test('characters outside the bech32 alphabet are refused', () => {
  const notBech32 = 'erd1' + 'b'.repeat(58);
  expect(Address.isValid(notBech32)).toBe(false);
  expect(isValidSafeAddress(notBech32)).toBe(false);
});

test('an import file with a mistyped address reports it as skipped, not added', () => {
  const file = JSON.stringify({ app: 'mvxsafe', safes: [{ name: 'Treasury', address: TYPO }] });
  expect(importSafes(file)).toEqual({ added: 0, skipped: 1 });
});
