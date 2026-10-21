/**
 * @jest-environment node
 */
// Backlog of the audit of 21 Oct 2026 (web report, cosmetic), proven by the
// main session: an ABI file whose endpoints have the wrong shape showed the
// call form's internal error ("....join is not a function", "Cannot read
// properties of null") instead of a sentence.
//
// Correct behaviour: a sentence that names the endpoint, and the file refused:
// an endpoint whose arguments cannot be read is never offered with some of
// them missing.
import { readAbi } from 'multisig/abiForm';

const endpoint = (fields: Record<string, unknown>) =>
  JSON.stringify({
    endpoints: [{ name: 'setFee', mutability: 'mutable', ...fields }]
  });

const INTERNAL = /is not a function|Cannot read propert|undefined|null/;

test('control: a well-formed endpoint is read, with its argument and its EGLD', () => {
  const abi = readAbi(
    endpoint({
      inputs: [{ name: 'fee', type: 'BigUint' }],
      payableInTokens: ['EGLD'],
      docs: ['Sets the fee.']
    })
  );
  expect(abi.endpoints[0].slots).toHaveLength(1);
  expect(abi.endpoints[0].takesEgld).toBe(true);
});

test.each([
  ['inputs that are not a list', { inputs: { fee: 'BigUint' } }],
  ['an input that is not an argument', { inputs: [null] }],
  ['tokens that are not a list', { payableInTokens: 'EGLD' }]
])(
  'an endpoint with %s is refused with a sentence that names it',
  (_, fields) => {
    let message = '';
    try {
      readAbi(endpoint(fields));
    } catch (failure) {
      message = (failure as Error).message;
    }
    expect(message).toMatch(/setFee/);
    expect(message).not.toMatch(INTERNAL);
  }
);

test('documentation that is not a list is only documentation: the endpoint is still read', () => {
  const abi = readAbi(endpoint({ inputs: [], docs: 'Sets the fee.' }));
  expect(abi.endpoints.map((one) => one.name)).toEqual(['setFee']);
});
