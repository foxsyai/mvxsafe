// DISP-06: the recipient of a transfer, the address added to the board or removed
// from it, is shown as 8 + 6 characters (shortAddress(a, 8, 6)) and nothing else:
// no full address, no label, no link, no copy. "erd1" is fixed and the last six
// characters are the checksum, so the visible part carries 50 bits. A second
// VALID address with the same 14 visible characters was found by brute force in
// 1.2e9 trials (8 minutes, one CPU; devnet/collide.mjs); an attacker who needs
// the private key grinds ed25519 keys, ~2^50 of them, which is GPU-farm work
// measured in days, not years, against 1.36 billion FOXSY.
jest.mock('multisig/network', () => require('./fixtures').networkMock);
jest.mock('lib', () => require('./mocks').libMock);
jest.mock('multisig/actions', () => require('./mocks').actionsMock);

import './restoreSetImmediate';
import { Address } from '@multiversx/sdk-core';
import { screen } from '@testing-library/react';
import { readPendingActions, shortAddress } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain } from './fixtures';
import { connectAs, renderSafe } from './renderSafe';

/** Valid bech32, same first 8 and last 6 characters as ALICE, different 32 bytes. */
export const LOOKALIKE = 'erd1v6zz4r4rvezugeh9qvjcysv0ylah37nk6g5j3dl3eakpfu5s2kysvh4kq3';

const describe1 = async (action: any) => {
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [{ id: 14, action, signers: [CAROL] }] });
  const [pending] = await readPendingActions(SAFE);
  return pending.description;
};

test('control: the look-alike is a different, valid address that shortens like alice', () => {
  expect(LOOKALIKE).not.toBe(ALICE);
  expect(Address.newFromBech32(LOOKALIKE).toBech32()).toBe(LOOKALIKE);
  expect(Address.newFromBech32(LOOKALIKE).toHex()).not.toBe(Address.newFromBech32(ALICE).toHex());
  expect(shortAddress(LOOKALIKE)).toBe(shortAddress(ALICE));
});

test('an EGLD transfer to alice and one to her look-alike must not read identically', async () => {
  const toAlice = await describe1({ kind: 'SendTransferExecute', to: ALICE, egld: 10n ** 16n });
  const toCopy = await describe1({ kind: 'SendTransferExecute', to: LOOKALIKE, egld: 10n ** 16n });
  expect(toCopy).not.toBe(toAlice);
});

test('adding alice to the board and adding her look-alike must not read identically', async () => {
  const alice = await describe1({ kind: 'AddBoardMember', address: ALICE });
  const copy = await describe1({ kind: 'AddBoardMember', address: LOOKALIKE });
  expect(copy).not.toBe(alice);
});

test('the card gives the signer the full recipient address, not only 14 characters of it', async () => {
  connectAs(BOB);
  useChain({
    quorum: 2, board: [ALICE, BOB, CAROL], roles: { [BOB]: 2 },
    pending: [{ id: 14, action: { kind: 'SendTransferExecute', to: LOOKALIKE, egld: 10n ** 16n }, signers: [CAROL] }]
  });
  const { container } = await renderSafe(SAFE);
  expect(screen.getByText('#14')).toBeTruthy();
  expect(container.innerHTML).toContain(LOOKALIKE);
});
