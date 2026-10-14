/**
 * @jest-environment node
 */
// UPG-03: a call's argument whose bytes spell a word is shown as that word ONLY.
// The chain does not say whether setFee's argument is a number or a text; the
// card's own rule (14 Oct 2026, the one-byte case 0x64 = 100 = "d") is to say
// both when it cannot know. For two bytes and more it says the word alone, so
// a rogue proposer can file setFee("disabled"), which the board reads as a
// text switching the fee off, while the contract reads the same eight bytes
// as the number 7,235,441,138,447,705,444: a fee of about 7.2 EGLD per vesting.
import { describeArgument, formatUnits } from 'multisig/describe';

const utf8 = (text: string) => Uint8Array.from(Buffer.from(text, 'utf8'));
const asNumber = (bytes: Uint8Array) =>
  bytes.reduce((value, byte) => (value << 8n) + BigInt(byte), 0n);
const grouped = (value: bigint) =>
  value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** True when the description gives the number the bytes also are, exactly or as EGLD. */
const saysTheNumber = (text: string, value: bigint) =>
  text.includes(grouped(value)) ||
  text.includes(`${formatUnits(value, 18)} EGLD`);

describe('control: what the card already does', () => {
  test('one byte that is also a letter is said both ways', () => {
    expect(describeArgument(Uint8Array.of(0x64))).toBe('100 [or the text "d"]');
  });

  test('"disabled" is the number 7,235,441,138,447,705,444, about 7.2 EGLD', () => {
    expect(asNumber(utf8('disabled')).toString()).toBe('7235441138447705444');
    expect(formatUnits(asNumber(utf8('disabled')), 18)).toBe(
      '7.235441138447705444'
    );
  });

  test('bytes that spell no word are a number, read as EGLD from 0.001 up', () => {
    // "disabled" with one bit flipped in each byte: no longer a word.
    const bytes = utf8('disabled').map((byte) => byte ^ 0x01);
    const text = describeArgument(bytes);
    expect(text).not.toContain('disabled');
    expect(saysTheNumber(text, asNumber(bytes))).toBe(true);
  });
});

describe('bytes that spell a word AND are a number', () => {
  test('setFee("disabled") is also setFee(7,235,441,138,447,705,444), 7.2 EGLD: both are said', () => {
    const bytes = utf8('disabled');
    const text = describeArgument(bytes);
    expect(text).toContain('disabled');
    expect(saysTheNumber(text, asNumber(bytes))).toBe(true);
  });

  test('two letters, "AB", are also 16,706: both are said', () => {
    const bytes = utf8('AB');
    const text = describeArgument(bytes);
    expect(text).toContain('AB');
    expect(saysTheNumber(text, 16706n)).toBe(true);
  });
});
