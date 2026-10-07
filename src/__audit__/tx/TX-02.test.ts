// TX-02: digits beyond the token's decimals are silently cut off.
//
// legacyCalls.js:75 pads the fraction and then slices it to `decimals`, so
// anything a person types past the token's precision disappears without a
// word. For a token with 0 decimals "1.5" proposes 1 and "0.5" proposes 0; for
// EGLD "0.0000000000000000001" proposes 0 and "1.0000000000000000019" proposes
// 1.000000000000000001. A treasury tool must refuse what it cannot represent
// rather than propose a different amount from the one typed.
import { toRawAmount } from 'multisig/legacyCalls';

describe('TX-02: an amount with more decimals than the token has is refused, not truncated', () => {
  test.each([
    ['0.0000000000000000001', 18], // today: 0
    ['1.0000000000000000019', 18], // today: 1000000000000000001
    ['1.5', 0], // today: 1
    ['0.5', 0], // today: 0
    ['1.1234567', 6] // today: 1123456
  ])('%s with %i decimals is refused', (text, decimals) => {
    expect(() => toRawAmount(text, decimals)).toThrow();
  });

  test('exact precision is still accepted', () => {
    expect(toRawAmount('1.000000000000000001', 18)).toBe(1000000000000000001n);
    expect(toRawAmount('2', 0)).toBe(2n);
    expect(toRawAmount('1.123456', 6)).toBe(1123456n);
  });
});
