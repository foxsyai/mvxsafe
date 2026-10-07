/**
 * @jest-environment node
 *
 * Node, not jsdom: the SDK hands decoded bytes back as node Buffers, and under
 * jest-environment-jsdom a Buffer is not instanceof the jsdom realm's Uint8Array,
 * which is a harness artefact a browser does not have (one realm).
 */
// DISP-07: an ESDTTransfer is described from its first two arguments only.
// Anything after them is a contract call that rides on the transfer (function
// name and its arguments), and an EGLD amount on the same action is ignored.
// The signer reads "Send 0.1 WEGLD to X" and nothing about the call.
jest.mock('multisig/network', () => require('./fixtures').networkMock);

import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, bigBytes, useChain } from './fixtures';

const describe1 = async (pendingAction: any) => {
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [{ id: 6, action: pendingAction, signers: [BOB] }] });
  const [action] = await readPendingActions(SAFE);
  return action.description;
};

test('control: a bare ESDTTransfer reads as a transfer', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: ALICE, endpoint: 'ESDTTransfer', args: ['WEGLD-a28c59', bigBytes(10n ** 17n)]
  });
  // Since the DISP-06/08 fixes the sentence carries the full identifier and address.
  expect(text).toBe('Send 0.1 WEGLD-a28c59 to erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3');
});

test('an ESDTTransfer that calls a function on arrival must name that function', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: ALICE, endpoint: 'ESDTTransfer',
    args: ['WEGLD-a28c59', bigBytes(10n ** 17n), 'swapTokensFixedInput', 'USDC-c76f1f', bigBytes(1n)]
  });
  expect(text).toContain('swapTokensFixedInput');
});

test('an ESDTTransfer that also carries EGLD must say so', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: ALICE, egld: 5n * 10n ** 17n, endpoint: 'ESDTTransfer',
    args: ['WEGLD-a28c59', bigBytes(10n ** 17n)]
  });
  expect(text).toMatch(/0\.5 EGLD/);
});
