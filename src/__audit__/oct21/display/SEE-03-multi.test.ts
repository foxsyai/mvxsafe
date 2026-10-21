/**
 * @jest-environment node
 */
// SEE-03, the MultiESDTNFTTransfer branch (asked for by the review of PR #11,
// 21 Oct 2026): the function a multi-token transfer calls after the tokens
// comes after the receiver, the count and three fields per token, and the
// count is a big-endian number of any length.
import { Address } from '@multiversx/sdk-core';
import { nestedBuiltInChecks } from 'multisig/inspect';

const TARGET = 'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
const SOMEONE =
  'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const utf8 = (text: string) => new TextEncoder().encode(text);
const address = (bech32: string) =>
  Address.newFromBech32(bech32).getPublicKey();
const token = (identifier: string) => [
  utf8(identifier),
  new Uint8Array(0),
  Uint8Array.of(0x0a)
];
const multi = (count: Uint8Array, tokens: string[], fn: string) => [
  address(TARGET),
  count,
  ...tokens.flatMap(token),
  utf8(fn),
  address(SOMEONE)
];
const red = (args: Uint8Array[]) =>
  nestedBuiltInChecks('MultiESDTNFTTransfer', args).some(
    (check) => check.tone === 'bad'
  );

test('control: two tokens, then an ordinary function: no red line', () => {
  expect(
    red(multi(Uint8Array.of(2), ['WEGLD-a28c59', 'USDC-350c4e'], 'deposit'))
  ).toBe(false);
});

test('two tokens, then ChangeOwnerAddress: red', () => {
  expect(
    red(
      multi(
        Uint8Array.of(2),
        ['WEGLD-a28c59', 'USDC-350c4e'],
        'ChangeOwnerAddress'
      )
    )
  ).toBe(true);
});

test('one token, the function is found right after its three fields', () => {
  expect(red(multi(Uint8Array.of(1), ['WEGLD-a28c59'], 'ESDTLocalMint'))).toBe(
    true
  );
});

test('a count written on two bytes is read as one number', () => {
  expect(
    red(
      multi(Uint8Array.of(0, 2), ['WEGLD-a28c59', 'USDC-350c4e'], 'SetGuardian')
    )
  ).toBe(true);
});

test('ClaimDeveloperRewards after the tokens is not red, as on its own', () => {
  expect(
    red(multi(Uint8Array.of(1), ['WEGLD-a28c59'], 'ClaimDeveloperRewards'))
  ).toBe(false);
});
