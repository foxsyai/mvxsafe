// SC-01 on the page (main session, 21 Oct 2026): an action the contract cannot
// return is listed so it can be got rid of, never signed or carried out. Both
// would fail on chain (the contract reads the action to perform it), and a
// signature only makes it harder to discard.
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);
jest.mock('multisig/reads', () => {
  const actual = jest.requireActual('multisig/reads');
  return {
    ...actual,
    readPendingActions: async () => (globalThis as any).__sc01Pending
  };
});

import '../../display/restoreSetImmediate';
import { screen } from '@testing-library/react';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';
import { connectAs, renderSafe } from '../../display/renderSafe';

const entry = (extra: Record<string, unknown>) => ({
  actionId: 4,
  name: 'Unreadable',
  description: 'Action #4 cannot be read.',
  checks: [],
  perform: { simulate: true },
  signerCount: 0,
  signers: [],
  formerSigners: [],
  quorumReached: false,
  ...extra
});

beforeEach(() => {
  connectAs(BOB);
  useChain({
    quorum: 1,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: []
  });
});

test('control: a readable action with the quorum offers Sign and Carry it out', async () => {
  (globalThis as any).__sc01Pending = [
    entry({
      name: 'ChangeQuorum',
      description: 'Change the number of signatures needed to 2',
      signerCount: 1,
      signers: [ALICE],
      quorumReached: true
    })
  ];
  await renderSafe(SAFE);
  expect(screen.getByText('Sign')).toBeTruthy();
  expect(screen.getByText('Carry it out')).toBeTruthy();
});

test('an unreadable action offers neither Sign nor Carry it out, and can be discarded', async () => {
  (globalThis as any).__sc01Pending = [entry({ unreadable: true })];
  await renderSafe(SAFE);
  expect(screen.queryByText('Sign')).toBeNull();
  expect(screen.queryByText('Carry it out')).toBeNull();
  expect((screen.getByText('Discard') as HTMLButtonElement).disabled).toBe(
    false
  );
});

test('a signed unreadable action offers Remove my signature, and still no Carry it out', async () => {
  (globalThis as any).__sc01Pending = [
    entry({
      unreadable: true,
      signerCount: 1,
      signers: [BOB],
      quorumReached: true
    })
  ];
  await renderSafe(SAFE);
  expect(screen.getByText('Remove my signature')).toBeTruthy();
  expect(screen.queryByText('Carry it out')).toBeNull();
});
