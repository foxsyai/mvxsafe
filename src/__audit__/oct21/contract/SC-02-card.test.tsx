// SC-02 on the page (main session, 21 Oct 2026): a ChangeQuorum(0) proposal is
// red on its card, and a safe whose quorum is already 0 says so in red and
// shows 0, not "unknown".
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);

import '../../display/restoreSetImmediate';
import { screen } from '@testing-library/react';
import { inspectAction } from 'multisig/inspect';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';
import { connectAs, renderSafe } from '../../display/renderSafe';

beforeEach(() => connectAs(BOB));

test('control: a quorum of 2 on a board of 3 reads "2 of 3", with no red banner', async () => {
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: []
  });
  await renderSafe(SAFE);
  expect(screen.getByText('2 of 3')).toBeTruthy();
  expect(screen.queryByText(/its quorum is 0/)).toBeNull();
});

test('a safe at quorum 0 shows 0 and says in red that nothing needs a signature', async () => {
  useChain({
    quorum: 0,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: []
  });
  await renderSafe(SAFE);
  expect(screen.getByText('0 of 3')).toBeTruthy();
  expect(screen.getByText(/its quorum is 0/)).toBeTruthy();
});

test('a ChangeQuorum(0) proposal carries a red check', async () => {
  const { checks } = await inspectAction(
    { name: 'ChangeQuorum', fields: [0] },
    SAFE
  );
  expect(
    checks.some(
      (check) => check.tone === 'bad' && /quorum of 0/i.test(check.text)
    )
  ).toBe(true);
});
