/**
 * @jest-environment node
 *
 * Node, not jsdom: the SDK hands decoded bytes back as node Buffers, and under
 * jest-environment-jsdom a Buffer is not instanceof the jsdom realm's Uint8Array,
 * which is a harness artefact a browser does not have (one realm).
 */
// DISP-10: endpoint names and token identifiers come straight out of the
// action's bytes into the sentence. Bidi overrides, zero-width characters and
// control characters are rendered as they are, so "ESDTTransfer" followed by a
// zero-width space looks exactly like ESDTTransfer but is not one.
jest.mock('multisig/network', () => require('./fixtures').networkMock);

import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, bigBytes, useChain } from './fixtures';

// Built from a string: SWC emits the escapes of a regex literal as the characters
// themselves, and U+2028 inside a literal then ends the line.
const INVISIBLE = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]'
);

const describe1 = async (pendingAction: any) => {
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [{ id: 9, action: pendingAction, signers: [BOB] }] });
  const [action] = await readPendingActions(SAFE);
  return action.description;
};

test('control: a plain endpoint name is shown as it is', async () => {
  const text = await describe1({ kind: 'SendAsyncCall', to: ALICE, endpoint: 'claimRewards' });
  expect(text).toContain('claimRewards');
  expect(text).not.toMatch(INVISIBLE);
});

test('a zero-width space inside an endpoint name must not reach the sentence unseen', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: ALICE, endpoint: 'ESDTTransfer​', args: ['WEGLD-a28c59', bigBytes(10n ** 17n)]
  });
  expect(text).not.toMatch(INVISIBLE);
});

test('a right-to-left override in an endpoint name must not reach the sentence', async () => {
  const text = await describe1({ kind: 'SendAsyncCall', to: ALICE, endpoint: '‮refsnart' });
  expect(text).not.toMatch(INVISIBLE);
});

test('a zero-width space inside a token identifier must not reach the sentence', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: ALICE, endpoint: 'ESDTTransfer', args: ['FOXSY​-5d5f3e', bigBytes(10n ** 18n)]
  });
  expect(text).not.toMatch(INVISIBLE);
});
