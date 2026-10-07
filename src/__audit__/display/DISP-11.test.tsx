// DISP-11: when the pending actions cannot be read (the API refuses after the
// retries, times out, a node is down), readPendingActions swallows the error and
// returns [], and the page says "Nothing is waiting for a signature." as if it
// had looked. The Actions tile says 0. A board member who checks the safe during
// an API incident is told, in so many words, that there is nothing to sign.
jest.mock('multisig/network', () => require('./fixtures').networkMock);
jest.mock('lib', () => require('./mocks').libMock);
jest.mock('multisig/actions', () => require('./mocks').actionsMock);

import './restoreSetImmediate';
import { screen } from '@testing-library/react';
import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain, useFailing } from './fixtures';
import { connectAs, renderSafe } from './renderSafe';

const pending = [{ id: 4, action: { kind: 'SendTransferExecute' as const, to: ALICE, egld: 10n ** 16n }, signers: [ALICE] }];

afterEach(() => useFailing([]));

test('control: when the read works, the action is listed', async () => {
  connectAs(BOB);
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], roles: { [BOB]: 2 }, pending });
  await renderSafe(SAFE);
  expect(screen.getByText('#4')).toBeTruthy();
  expect(screen.queryByText('Nothing is waiting for a signature.')).toBeNull();
});

test('readPendingActions must not answer "no pending actions" when the contract could not be read', async () => {
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending });
  useFailing(['getPendingActionFullInfo']);
  const answer = await readPendingActions(SAFE).then((list) => list, () => 'rejected');
  expect(answer).not.toEqual([]);
});

test('the page must not say "Nothing is waiting for a signature." when the read failed', async () => {
  connectAs(BOB);
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], roles: { [BOB]: 2 }, pending });
  useFailing(['getPendingActionFullInfo']);
  await renderSafe(SAFE);
  expect(screen.queryByText('Nothing is waiting for a signature.')).toBeNull();
});
