// SGN-01: mvxsafe never checks that an opened "safe" actually runs the multisig
// bytecode it was built and tested against. It trusts whatever a contract answers
// to the views. So a contract that is NOT this multisig -- an attacker's own
// contract, deployed at a look-alike address and reached from a link -- can answer
// getQuorum / getAllBoardMembers / userRole / getPendingActionFullInfo with
// anything it likes, and the Safe page renders it as a genuine 2-of-3 safe: it
// tells the connected wallet "you are a board member here", shows a board, shows a
// benign-looking pending action, and offers Sign and Carry it out.
//
// Every sentence a signer reads then comes from a contract the attacker wrote, so
// the card is the maximal "difference between what the contract will do and what
// the card says": it is pure fiction. The only thing that could distinguish the
// real multisig from a look-alike is the code hash the network reports, and the
// app has the expected value (MULTISIG_CODE_HASH) but never compares it. The owner
// check ("not in its own hands") does not help: a fake contract simply reports
// itself as its own owner, as this test does.
//
// Fix: compare readContractInfo(safe).codeHash with MULTISIG_CODE_HASH (both via
// normalizeCodeHash) and show a prominent warning -- and hold Sign / Carry it out --
// when it does not match (the contract is not the multisig mvxsafe knows).
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);

import '../../display/restoreSetImmediate';
import { screen } from '@testing-library/react';
import { MULTISIG_CODE_HASH } from 'multisig/legacyCalls';
import { contract, mockAccounts } from '../../../multisig/tests/contractsMock';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';
import { connectAs, renderSafe } from '../../display/renderSafe';

// The multisig's real code hash, as the API states it (base64), expressed in hex
// for the fixture's contract() helper.
const REAL_HEX = Buffer.from(MULTISIG_CODE_HASH, 'base64').toString('hex');
// Any other contract's code hash: not the multisig.
const FAKE_HEX = '44'.repeat(32);

// A warning that the opened contract is not the multisig mvxsafe knows. The exact
// wording is for the fix; this matches the concept (its code / code hash is not
// the known/expected multisig). None of it is present on the page today.
const CODE_WARNING =
  /code hash|not the (known |expected )?multisig|does not (run|match).{0,40}multisig|not the (code|contract) mvxsafe|unverified contract/i;

const openAs = async (hashHex: string) => {
  connectAs(BOB);
  mockAccounts[SAFE] = contract({ owner: SAFE, hash: hashHex });
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: [
      {
        id: 1,
        action: { kind: 'SendTransferExecute', to: ALICE, egld: 10n ** 16n },
        signers: [CAROL]
      }
    ]
  });
  return renderSafe(SAFE);
};

test('premise: the page fully trusts a contract whose code it never checked', async () => {
  const { container } = await openAs(FAKE_HEX);
  // It is treated as a real safe: the viewer is told they are on the board and
  // offered Sign on an action described by the (untrusted) contract.
  expect(screen.getByText(/a board member here/i)).toBeTruthy();
  expect(screen.getByText('Sign')).toBeTruthy();
  expect(container.innerHTML).toContain('0.01 EGLD');
});

test('control: a safe whose code hash IS the multisig is not flagged', async () => {
  const { container } = await openAs(REAL_HEX);
  expect(CODE_WARNING.test(container.innerHTML)).toBe(false);
});

test('a contract whose code hash is NOT the multisig must be flagged before a signer trusts it', async () => {
  const { container } = await openAs(FAKE_HEX);
  expect(CODE_WARNING.test(container.innerHTML)).toBe(true);
});
