// Backlog of the audit of 21 Oct 2026 (web report: "an upper-case bech32
// address is refused"), proven by the main session. Bech32 allows an address
// written wholly in capitals, which is how a QR code often carries it, and
// every check here took lower case only: the Add form, an import, a board row
// and every builder refused it. Mixed case is invalid bech32 and stays refused.
// And one member typed once in each case was not caught as a duplicate.
import { parseAddress } from 'multisig/legacyCalls';
import { checkBoard } from 'multisig/newSafe';
import {
  addSafe,
  getSavedSafes,
  importSafes,
  isValidSafeAddress
} from 'multisig/savedSafes';

const LOWER = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const UPPER = LOWER.toUpperCase();
const MIXED = 'erd1V6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const SAFE = 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';

beforeEach(() => window.localStorage.clear());

test('control: the lower-case address is read', () => {
  expect(parseAddress(LOWER).toBech32()).toBe(LOWER);
});

test('a builder reads the capitals as the same address, and refuses mixed case', () => {
  expect(parseAddress(UPPER).toBech32()).toBe(LOWER);
  expect(() => parseAddress(MIXED)).toThrow(/not a valid/);
});

test('a board row in capitals is the member, and the same member twice is caught', () => {
  expect(checkBoard([UPPER], 1).board).toEqual([LOWER]);
  expect(checkBoard([LOWER, UPPER], 1).rowErrors[1]).toBe(
    'Already on the board.'
  );
});

test('a safe added or imported in capitals is kept in lower case', () => {
  expect(isValidSafeAddress(SAFE.toUpperCase())).toBe(true);
  addSafe({ name: 'Treasury', address: SAFE.toUpperCase() });
  expect(getSavedSafes().map((safe) => safe.address)).toEqual([SAFE]);
  window.localStorage.clear();
  importSafes(
    JSON.stringify({
      safes: [{ name: 'Treasury', address: SAFE.toUpperCase() }]
    })
  );
  expect(getSavedSafes().map((safe) => safe.address)).toEqual([SAFE]);
});
