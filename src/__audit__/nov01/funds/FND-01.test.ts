/**
 * @jest-environment node
 *
 * FND-01: a former board member's old signatures come back to life the moment
 * they are re-added, and the card for re-adding them does not say so.
 *
 * Contract fact, proven on the exact bytecode in the Go VM
 * (audit-2026-11-01/funds/scenarios/quorum-accounting.scen.json): signatures
 * are stored as user ids, a removed member keeps their id with the role None,
 * and getActionValidSignerCount counts only ids whose role is BoardMember
 * today. Remove the member and the signature stops counting; add them back and
 * it counts again, on every action they ever signed and that is still pending.
 *
 * So "Add X to the board" can be the last step of a drain: a pending transfer
 * signed by X before X was removed, plus one lingering signature from a member
 * still on the board, reaches its quorum the instant X is back, and X, a board
 * member again, carries it out. The page shows the old signature struck
 * through on the transfer's card ("has left the board and does not count"),
 * which is true until the re-add is carried out, and says nothing on the
 * re-add's card.
 *
 * Correct behaviour, asserted here: the card of an AddBoardMember (or an
 * AddProposer that promotes nobody, or any action that gives X a board seat)
 * names every pending action X has signed, says those signatures count again
 * once this is carried out, and is red when one of them would then reach the
 * quorum.
 */
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);

import { Address } from '@multiversx/sdk-core';
import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';

// Carol signed #1 while on the board, then was removed: the board is Alice and Bob.
const MALLORY = CAROL;
const DAVE = new Address(new Uint8Array(32).fill(7)).toBech32();

const chain = (readd: string) => ({
  quorum: 2,
  board: [ALICE, BOB],
  pending: [
    {
      id: 1,
      action: {
        kind: 'SendTransferExecute' as const,
        to: MALLORY,
        egld: 10n ** 18n
      },
      signers: [ALICE, MALLORY]
    },
    {
      id: 2,
      action: { kind: 'AddBoardMember' as const, address: readd },
      signers: [ALICE]
    }
  ]
});

const textOf = (action: { description: string; checks?: { text: string }[] }) =>
  [
    action.description,
    ...(action.checks ?? []).map((check) => check.text)
  ].join(' ');

test('control: the transfer shows one valid signature and the former member struck through', async () => {
  useChain(chain(MALLORY));
  const list = await readPendingActions(SAFE);
  const transfer = list.find((action) => action.actionId === 1)!;
  expect(transfer.signerCount).toBe(1);
  expect(transfer.quorumReached).toBe(false);
  expect(transfer.formerSigners).toEqual([MALLORY]);
});

test('control: re-adding an address that signed nothing carries no such warning', async () => {
  useChain(chain(DAVE));
  const list = await readPendingActions(SAFE);
  const readd = list.find((action) => action.actionId === 2)!;
  expect(textOf(readd)).not.toMatch(/#1/);
  expect((readd.checks ?? []).some((check) => check.tone === 'bad')).toBe(
    false
  );
});

test('re-adding a former signer says which pending actions their signature completes, in red', async () => {
  useChain(chain(MALLORY));
  const list = await readPendingActions(SAFE);
  const readd = list.find((action) => action.actionId === 2)!;
  const text = textOf(readd);
  // It names the action whose signature would count again...
  expect(text).toMatch(/#1/);
  expect(text).toMatch(/signature/i);
  // ...and it is red, because #1 would reach its quorum of 2 the moment this is carried out.
  expect(
    (readd.checks ?? []).some(
      (check) => check.tone === 'bad' && /#1/.test(check.text)
    )
  ).toBe(true);
});
