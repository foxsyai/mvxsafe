/**
 * @jest-environment node
 *
 * SC-01 (high): one pending action with a large call argument makes the
 * contract's getPendingActionFullInfo view fail to decode ("storage decode
 * error"). That view is the ONLY source readPendingActions reads to list the
 * pending actions, so a single ~12 KB action (buildable from mvxsafe's own Call
 * form, or by any proposer) makes readPendingActions throw and the whole board
 * loses sight of EVERY pending action -- it cannot see, sign, carry out or
 * discard anything through mvxsafe, legitimate actions included.
 *
 * Proven on devnet by proofs/SC-01.mjs (exit 1): getPendingActionFullInfo fails
 * while getActionData(legit) and the signer views still answer per id, so the
 * readable actions can be reconstructed and the poison one discarded by id.
 *
 * Correct behaviour, asserted here: when the bulk view cannot be decoded,
 * readPendingActions still returns the actions it CAN read per id, and still
 * surfaces the undecodable one so the board can discard it.
 */
jest.mock('multisig/network', () => require('./SC-01.mock').networkMock);

import { readPendingActions } from 'multisig/reads';
import { LEGIT_ID, POISON_ID, SAFE, setBulkFails } from './SC-01.mock';

test('control: when the bulk view decodes, the pending actions are listed', async () => {
  setBulkFails(false);
  const list = await readPendingActions(SAFE);
  expect(list.map((action) => action.actionId)).toContain(LEGIT_ID);
  expect(
    list.find((action) => action.actionId === LEGIT_ID)!.description
  ).toMatch(/EGLD/);
});

test('a legitimate action is still visible when one oversized action breaks the bulk view', async () => {
  setBulkFails(true);
  const list = await readPendingActions(SAFE);
  const legit = list.find((action) => action.actionId === LEGIT_ID);
  expect(legit).toBeDefined();
  expect(legit!.description).toMatch(/EGLD/);
});

test('the undecodable action is still surfaced, so the board can discard it', async () => {
  setBulkFails(true);
  const list = await readPendingActions(SAFE);
  expect(list.map((action) => action.actionId)).toContain(POISON_ID);
});
