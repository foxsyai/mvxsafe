/**
 * @jest-environment node
 */
// The last cosmetic point of the audit of 21 Oct 2026 (noticed by the review
// of PR #15), proven by the main session: an ABI whose enum lists a variant
// that is not one (null) showed the form's own TypeError, and a variant with
// no discriminant was offered as a choice whose value was "undefined".
//
// Correct behaviour: such an enum is refused with a sentence that names it;
// a well-formed one is offered as its choices.
import { readAbi } from 'multisig/abiForm';

const withEnum = (variants: unknown) =>
  JSON.stringify({
    endpoints: [
      {
        name: 'setMode',
        mutability: 'mutable',
        inputs: [{ name: 'mode', type: 'Mode' }]
      }
    ],
    types: { Mode: { type: 'enum', variants } }
  });

const INTERNAL = /is not a function|Cannot read propert|undefined|null/;

test('control: a well-formed enum is offered as its choices', () => {
  const abi = readAbi(
    withEnum([
      { name: 'Off', discriminant: 0 },
      { name: 'On', discriminant: 1 }
    ])
  );
  expect(abi.endpoints[0].slots[0].choices).toEqual([
    { label: 'Off (0)', value: '0' },
    { label: 'On (1)', value: '1' }
  ]);
});

test.each([
  ['a variant that is null', [null]],
  ['a variant with no discriminant', [{ name: 'Off' }]],
  ['a variant with no name', [{ discriminant: 0 }]],
  // Asked for by the review of PR #16: the guard is all that stands in front
  // of variants.every(...), and the discriminant has to be a whole number.
  ['no variants at all', undefined],
  ['variants that are not a list', 'Off,On'],
  ['a discriminant written as text', [{ name: 'Off', discriminant: '0' }]],
  ['a negative discriminant', [{ name: 'Off', discriminant: -1 }]]
])(
  'an enum with %s is refused with a sentence that names it',
  (_, variants) => {
    let message = '';
    try {
      readAbi(withEnum(variants));
    } catch (failure) {
      message = (failure as Error).message;
    }
    expect(message).toMatch(/Mode/);
    expect(message).not.toMatch(INTERNAL);
  }
);
