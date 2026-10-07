// DISP-05, what the board member sees: with a signature from someone no longer on
// the board, the card offers "Carry it out" (the contract will refuse) and
// disables "Discard" (the contract would allow it). See DISP-05.test.ts for the
// reader-level proof and the recorded devnet state.
jest.mock('multisig/network', () => require('./fixtures').networkMock);
jest.mock('lib', () => require('./mocks').libMock);
jest.mock('multisig/actions', () => require('./mocks').actionsMock);

import './restoreSetImmediate';
import { screen } from '@testing-library/react';
import { ALICE, BOB, CAROL, SAFE, useChain } from './fixtures';
import { connectAs, renderSafe } from './renderSafe';

const egldToAlice = { kind: 'SendTransferExecute' as const, to: ALICE, egld: 10n ** 16n };
beforeEach(() => connectAs(BOB));

test('control: two current signers of a quorum of two, and Carry it out is offered', async () => {
  useChain({ quorum: 2, board: [ALICE, BOB], roles: { [BOB]: 2 }, pending: [{ id: 4, action: egldToAlice, signers: [ALICE, BOB] }] });
  await renderSafe(SAFE);
  expect(screen.getByText('Carry it out')).toBeTruthy();
  expect(screen.getByText(/2 of 2 signatures/)).toBeTruthy();
});

test('a signature from a removed member must not make Carry it out appear or count in the badge', async () => {
  // carol signed, then was removed; alice signed. The contract: 1 valid of 2, quorum not reached.
  useChain({ quorum: 2, board: [ALICE, BOB], roles: { [BOB]: 2 }, pending: [{ id: 4, action: egldToAlice, signers: [CAROL, ALICE] }] });
  await renderSafe(SAFE);
  expect(screen.queryByText(/2 of 2 signatures/)).toBeNull();
  expect(screen.queryByText('Carry it out')).toBeNull();
});

test('an action whose only signer left the board must be discardable', async () => {
  useChain({ quorum: 2, board: [ALICE, BOB], roles: { [BOB]: 2 }, pending: [{ id: 4, action: egldToAlice, signers: [CAROL] }] });
  await renderSafe(SAFE);
  const discard = screen.getByText('Discard') as HTMLButtonElement;
  expect(discard.disabled).toBe(false);
});
