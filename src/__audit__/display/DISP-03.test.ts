/**
 * @jest-environment node
 *
 * Node, not jsdom: the SDK hands decoded bytes back as node Buffers, and under
 * jest-environment-jsdom a Buffer is not instanceof the jsdom realm's Uint8Array,
 * which is a harness artefact a browser does not have (one realm).
 */
// DISP-03: "Call <function> on <address>" drops every argument. For a call on
// the ESDT system contract the arguments ARE the action: which token, which
// address gets which role, who becomes owner. The signer sees none of it.
jest.mock('multisig/network', () => require('./fixtures').networkMock);

import { Address } from '@multiversx/sdk-core';
import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, ESDT_SYSTEM_SC, SAFE, bigBytes, useChain } from './fixtures';

const pk = (bech32: string) => Address.newFromBech32(bech32).getPublicKey();

const describe1 = async (pendingAction: any) => {
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [{ id: 5, action: pendingAction, signers: [BOB] }] });
  const [action] = await readPendingActions(SAFE);
  return action.description;
};

test('control: a call with no arguments names the function and the contract', async () => {
  const text = await describe1({ kind: 'SendAsyncCall', to: ESDT_SYSTEM_SC, endpoint: 'claimDeveloperRewards' });
  expect(text).toContain('claimDeveloperRewards');
  expect(text).toContain('erd1qqqq');
});

test('setSpecialRole must show the token, the address and the role being granted', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: ESDT_SYSTEM_SC, endpoint: 'setSpecialRole',
    args: ['FOXSY-5d5f3e', pk(ALICE), 'ESDTRoleLocalMint']
  });
  expect(text).toContain('FOXSY-5d5f3e');
  expect(text).toContain('ESDTRoleLocalMint');
  expect(text).toContain('erd1v6zz'); // alice, who would be able to mint
});

test('transferOwnership must show the token and the new owner', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: ESDT_SYSTEM_SC, endpoint: 'transferOwnership',
    args: ['FOXSY-5d5f3e', pk(ALICE)]
  });
  expect(text).toContain('FOXSY-5d5f3e');
  expect(text).toContain('erd1v6zz');
});

test('ESDTLocalMint on the safe itself must show the token and the amount minted', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: SAFE, endpoint: 'ESDTLocalMint',
    args: ['FOXSY-5d5f3e', bigBytes(1000000000n * 10n ** 18n)]
  });
  expect(text).toContain('FOXSY-5d5f3e');
  expect(text).toMatch(/1,000,000,000/);
});
