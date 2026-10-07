/**
 * @jest-environment node
 *
 * Node, not jsdom: the SDK hands decoded bytes back as node Buffers, and under
 * jest-environment-jsdom a Buffer is not instanceof the jsdom realm's Uint8Array,
 * which is a harness artefact a browser does not have (one realm).
 */
// DISP-05: signatures are counted from getPendingActionFullInfo.signers, which
// lists everyone who ever signed, including people since removed from the board.
// The contract counts only current board members (getActionValidSignerCount,
// quorumReached). So the card can say "2 of 2 signatures", show "Carry it out"
// and refuse Discard, while the contract says the quorum is NOT reached and the
// action CAN be discarded.
jest.mock('multisig/network', () => require('./fixtures').networkMock);

import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain, useRecorded } from './fixtures';

const egldToAlice = { kind: 'SendTransferExecute' as const, to: ALICE, egld: 10n ** 16n };

test('control: two current board members reach a quorum of two', async () => {
  useChain({ quorum: 2, board: [ALICE, BOB], pending: [{ id: 4, action: egldToAlice, signers: [ALICE, BOB] }] });
  const [action] = await readPendingActions(SAFE);
  expect(action.quorumReached).toBe(true);
});

test('a signature from a removed board member must not count towards the quorum', async () => {
  // carol signed, then was removed from the board; alice signed too. Valid: 1 of 2.
  useChain({ quorum: 2, board: [ALICE, BOB], pending: [{ id: 4, action: egldToAlice, signers: [CAROL, ALICE] }] });
  const [action] = await readPendingActions(SAFE);
  expect(action.quorumReached).toBe(false);
});

test('an action whose only signer left the board must be reported as carrying no valid signature', async () => {
  useChain({ quorum: 2, board: [ALICE, BOB], pending: [{ id: 4, action: egldToAlice, signers: [CAROL] }] });
  const [action] = await readPendingActions(SAFE);
  // signerCount is what Safe.tsx uses to disable Discard and to print "N of Q signatures".
  expect(action.signerCount).toBe(0);
});

test('recorded devnet safe B: carol signed action 1 and then left the board; the contract counts 0 valid signatures', async () => {
  const recorded = require('./recorded-devnet.json');
  // The contract's own answers, recorded: validSignerCount(1) = 0, quorumReached(1) = false.
  expect(recorded.safeB.getActionValidSignerCount_1).toEqual(['']);
  expect(recorded.safeB.quorumReached_1).toEqual(['']);
  useRecorded(recorded.safeB);
  const [action] = await readPendingActions(recorded.safeB.address);
  useRecorded(null);
  expect(action.actionId).toBe(1);
  expect(action.quorumReached).toBe(false);
  expect(action.signerCount).toBe(0);
});
