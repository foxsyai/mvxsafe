/**
 * @jest-environment node
 *
 * Node, not jsdom: the SDK hands decoded bytes back as node Buffers, and under
 * jest-environment-jsdom a Buffer is not instanceof the jsdom realm's Uint8Array,
 * which is a harness artefact a browser does not have (one realm).
 */
// DISP-04: the EGLD amount of an action is read with BigInt(BigNumber.toString()).
// BigNumber writes 1e21 and above in exponential notation ("1e+21"), BigInt
// refuses it, and asBigInt falls back to 0. From 1000 EGLD upwards the amount
// disappears: a plain transfer becomes "Unreadable call", and a call with EGLD
// loses its "with N EGLD".
jest.mock('multisig/network', () => require('./fixtures').networkMock);

import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain } from './fixtures';

const describe1 = async (pendingAction: any) => {
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [{ id: 2, action: pendingAction, signers: [BOB] }] });
  const [action] = await readPendingActions(SAFE);
  return action.description;
};

test('control: 999 EGLD reads as a transfer of 999 EGLD', async () => {
  const text = await describe1({ kind: 'SendTransferExecute', to: ALICE, egld: 999n * 10n ** 18n });
  expect(text).toMatch(/^Send 999 EGLD to erd1v6zz/);
});

test('1,000 EGLD must read as a transfer of 1,000 EGLD', async () => {
  const text = await describe1({ kind: 'SendTransferExecute', to: ALICE, egld: 1000n * 10n ** 18n });
  expect(text).toMatch(/^Send 1,000 EGLD to erd1v6zz/);
});

test('a call carrying 2,500 EGLD must say so', async () => {
  const text = await describe1({ kind: 'SendAsyncCall', to: ALICE, egld: 2500n * 10n ** 18n, endpoint: 'delegate' });
  expect(text).toContain('delegate');
  expect(text).toMatch(/2,500 EGLD/);
});
