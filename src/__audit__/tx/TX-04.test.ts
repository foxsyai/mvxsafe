// TX-04: toRawAmount accepts whatever BigInt() accepts, which is not decimal.
//
// legacyCalls.js:76 hands the joined string to BigInt(), whose grammar accepts
// hex, binary and octal prefixes. With 18 decimals "0x10" becomes
// 0x10000000000000000000 = 75,557.86 EGLD, "0o7" becomes 0.126 EGLD and
// "0b1" becomes 262144 wei. Splitting on every dot and keeping only the first
// two parts also means "1..5" proposes 1, "1.5.5" proposes 1.5 and "1.2.3.4"
// proposes 1.2: a typo is not refused, it is reinterpreted.
import { toRawAmount } from 'multisig/legacyCalls';

describe('TX-04: only a plain decimal number is accepted as an amount', () => {
  test.each([
    '0x10', // today: 75557863725914323419136
    '0X10', // today: 75557863725914323419136
    '0b1', // today: 262144
    '0o7', // today: 126100789566373888
    '1..5', // today: 1000000000000000000
    '1.5.5', // today: 1500000000000000000
    '1.2.3.4' // today: 1200000000000000000
  ])('%s is refused', (text) => {
    expect(() => toRawAmount(text, 18)).toThrow();
  });

  test('plain decimals still work', () => {
    expect(toRawAmount('16', 18)).toBe(16n * 10n ** 18n);
    expect(toRawAmount('1.5', 18)).toBe(15n * 10n ** 17n);
    expect(toRawAmount('.5', 18)).toBe(5n * 10n ** 17n);
    expect(toRawAmount('1.', 18)).toBe(10n ** 18n);
  });
});
