// TX-01: a comma used as a thousands separator divides the amount by 1000.
//
// legacyCalls.js:74 replaces the FIRST comma with a dot and then splits on dots,
// so "250,000" (two hundred and fifty thousand, written the way most people and
// every US-locale spreadsheet write it) is parsed as 250.000 and the proposal
// put in front of the board is for 250 tokens. "1.000,5" (European for one
// thousand and a half) becomes 1. The proposer signs a transaction for a
// thousandth of what they typed, with no error.
//
// Correct behaviour is fix-agnostic here: either refuse the ambiguous input or
// read it as thousands. What must never happen is the thousandfold shrink.
// (Values are compared as strings: jest-worker cannot serialise a BigInt in a
// failure message.)
import { toRawAmount } from 'multisig/legacyCalls';

const ONE = 10n ** 18n;

const parse = (text: string): string => {
  try {
    return toRawAmount(text, 18).toString();
  } catch {
    return 'rejected';
  }
};

describe('TX-01: a thousands separator must not divide the amount by 1000', () => {
  test('"250,000" is refused or read as 250000, never as 250', () => {
    const result = parse('250,000');
    expect(result).not.toBe((250n * ONE).toString());
    expect(['rejected', (250000n * ONE).toString()]).toContain(result);
  });

  test('"1,000" is refused or read as 1000, never as 1', () => {
    const result = parse('1,000');
    expect(result).not.toBe((1n * ONE).toString());
    expect(['rejected', (1000n * ONE).toString()]).toContain(result);
  });

  test('"1,000.00" (a spreadsheet paste) is refused or read as 1000, never as 1', () => {
    const result = parse('1,000.00');
    expect(result).not.toBe((1n * ONE).toString());
    expect(['rejected', (1000n * ONE).toString()]).toContain(result);
  });

  test('"1.000,5" is refused or read as 1000.5, never as 1', () => {
    const result = parse('1.000,5');
    expect(result).not.toBe((1n * ONE).toString());
    expect(['rejected', (10005n * (ONE / 10n)).toString()]).toContain(result);
  });
});
