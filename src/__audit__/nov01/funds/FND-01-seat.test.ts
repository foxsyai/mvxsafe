/**
 * @jest-environment node
 *
 * What FND-01 does not pin: amber when no action reaches its quorum, several
 * actions by id, a promotion from proposer, and the reverse note: taking a seat
 * away stops a signature counting, and does not erase it.
 */
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);

import { Address } from '@multiversx/sdk-core';
import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';

const DAVE = new Address(new Uint8Array(32).fill(7)).toBech32();
const send = {
  kind: 'SendTransferExecute' as const,
  to: DAVE,
  egld: 10n ** 18n
};

const cardOf = async (id: number) => {
  const action = (await readPendingActions(SAFE)).find(
    (candidate) => candidate.actionId === id
  )!;
  const line = (action.checks ?? []).find((check) =>
    /signed #/.test(check.text)
  );
  return { action, line };
};

test('below the quorum even so: amber, with the count', async () => {
  useChain({
    quorum: 3,
    board: [ALICE, BOB, DAVE],
    pending: [
      { id: 1, action: send, signers: [CAROL] },
      { id: 2, action: { kind: 'AddBoardMember', address: CAROL } }
    ]
  });
  const { line } = await cardOf(2);
  expect(line?.tone).toBe('warn');
  expect(line?.text).toContain(
    `${CAROL} signed #1 before leaving the board. That signature counts again once this is carried out: #1 then has 1 of 3 signatures.`
  );
});

test('several actions: all named, red for the one reaching its quorum and said by id', async () => {
  useChain({
    quorum: 2,
    board: [ALICE, BOB],
    pending: [
      { id: 1, action: send, signers: [CAROL] },
      { id: 3, action: send, signers: [ALICE, CAROL] },
      { id: 4, action: { kind: 'AddBoardMember', address: CAROL } }
    ]
  });
  const { line } = await cardOf(4);
  expect(line?.tone).toBe('bad');
  expect(line?.text).toContain('signed #1 and #3 before leaving the board');
  expect(line?.text).toContain('#1 then has 1 of 2 signatures');
  expect(line?.text).toContain('#3 then has 2 of 2 signatures');
  expect(line?.text).toContain('#3 could then be carried out at once');
  expect(line?.text).not.toContain('#1 could');
});

test('a promotion from proposer gives the seat too', async () => {
  useChain({
    quorum: 2,
    board: [ALICE, BOB],
    proposerList: [CAROL],
    pending: [
      { id: 1, action: send, signers: [ALICE, CAROL] },
      { id: 2, action: { kind: 'AddBoardMember', address: CAROL } }
    ]
  });
  const { action, line } = await cardOf(2);
  expect(action.description).toMatch(/a proposer today/);
  expect(line?.tone).toBe('bad');
  expect(line?.text).toContain('#1');
});

test('RemoveUser: the reverse note, with the count, and not erased', async () => {
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    pending: [
      { id: 1, action: send, signers: [ALICE, CAROL] },
      { id: 2, action: { kind: 'RemoveUser', address: CAROL } }
    ]
  });
  const { line } = await cardOf(2);
  expect(line?.tone).toBe('warn');
  expect(line?.text).toContain(`${CAROL} signed #1.`);
  expect(line?.text).toContain('stops counting');
  expect(line?.text).toContain('#1 then has 1 of 2 signatures');
  expect(line?.text).toContain('They are not erased');
});

test('a demotion to proposer takes the seat the same way', async () => {
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    pending: [
      { id: 1, action: send, signers: [CAROL] },
      { id: 2, action: { kind: 'AddProposer', address: CAROL } }
    ]
  });
  const { line } = await cardOf(2);
  expect(line?.text).toContain('stops counting');
});

test('control: removing a member who signed nothing, or a proposer, carries no note', async () => {
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    proposerList: [DAVE],
    pending: [
      { id: 1, action: send, signers: [ALICE] },
      { id: 2, action: { kind: 'RemoveUser', address: CAROL } },
      { id: 3, action: { kind: 'RemoveUser', address: DAVE } }
    ]
  });
  expect((await cardOf(2)).line).toBeUndefined();
  expect((await cardOf(3)).line).toBeUndefined();
});

test('control: an action does not count its own signers against itself', async () => {
  useChain({
    quorum: 2,
    board: [ALICE, BOB],
    pending: [
      {
        id: 2,
        action: { kind: 'AddBoardMember', address: CAROL },
        signers: [CAROL]
      }
    ]
  });
  expect((await cardOf(2)).line).toBeUndefined();
});
