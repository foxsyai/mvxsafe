import {
  actionIdInData,
  buildDiscard,
  buildPerform,
  buildSign,
  buildUnsign
} from 'multisig/legacyCalls';

// A wallet shows the raw data of a call, where the action number travels in
// hex: #10 is sign@0a, #16 is sign@10. The card shows the same ending, so a
// signer whose wallet shows only the data (MetaMask's Snap) can match them
// (review of PR #24, 5 Nov 2026).

const context = {
  chainId: 'D',
  sender: 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx',
  nonce: 0,
  safe: 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq'
};
const calls = [
  [buildSign, 'sign'],
  [buildUnsign, 'unsign'],
  [buildDiscard, 'discardAction'],
  [buildPerform, 'performAction']
] as const;

test('is in hex: #1 is 01, #10 is 0a, #16 is 10', () => {
  expect(actionIdInData(1)).toBe('01');
  expect(actionIdInData(10)).toBe('0a');
  expect(actionIdInData(16)).toBe('10');
});

test.each([1, 9, 10, 16, 255, 256, 4096])(
  'action %i is written exactly as its sign, unsign, discard and carry out calls write it',
  async (id) => {
    for (const [build, name] of calls) {
      const transaction = await build(context, id);
      expect(Buffer.from(transaction.data).toString()).toBe(
        `${name}@${actionIdInData(id)}`
      );
    }
  }
);
