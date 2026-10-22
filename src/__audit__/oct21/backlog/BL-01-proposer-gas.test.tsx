// Backlog of the audit of 21 Oct 2026, item 1 (noticed by the web auditor,
// proven by the main session): the contract lets a proposer carry out an
// action ("only board members and proposers can perform actions", in the
// multisig's own code), and the page offers a proposer "Carry it out". But
// the field for the gas of a perform the network cannot simulate was shown to
// board members only, so a proposer could carry such an action out only with
// the default budget, and never give the one it needs.
//
// Correct behaviour: whoever is offered "Carry it out" is offered the gas.
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => ({
  ...require('../../display/mocks').actionsMock,
  performAction: jest.fn(async () => undefined)
}));

import '../../display/restoreSetImmediate';
import { act, fireEvent, screen } from '@testing-library/react';
import { performAction } from 'multisig/actions';
import { predictSafeAddress } from 'multisig/legacyCalls';
import {
  contract,
  mockAccounts,
  mockCode
} from '../../../multisig/tests/contractsMock';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';
import { connectAs, renderSafe } from '../../display/renderSafe';

const PROPOSER =
  'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const TARGET = predictSafeAddress(CAROL, 40);
const SOURCE = predictSafeAddress(ALICE, 60); // shard 1, the safe's

const signedUpgrade = (viewer: string, role: number) => {
  connectAs(viewer);
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    proposers: 1,
    proposerList: [PROPOSER],
    roles: { [viewer]: role },
    pending: [
      {
        id: 5,
        action: {
          kind: 'SCUpgradeFromSource',
          scAddress: TARGET,
          source: SOURCE,
          codeMetadata: Uint8Array.of(0x05, 0x00)
        },
        signers: [ALICE, BOB]
      }
    ]
  });
};

beforeEach(() => {
  (performAction as jest.Mock).mockClear();
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: mockCode('old') });
  mockAccounts[SOURCE] = contract({
    owner: ALICE,
    hash: mockCode('new'),
    upgradeable: false
  });
});

test('control: a board member sees the gas of an upgrade with its quorum', async () => {
  signedUpgrade(CAROL, 2);
  await renderSafe(SAFE);
  expect(screen.getByLabelText('Gas for action 5')).toBeTruthy();
});

test('a proposer, who may carry it out, sees the gas and carries it out with the gas typed', async () => {
  signedUpgrade(PROPOSER, 1);
  await renderSafe(SAFE);
  expect(screen.getByText('Carry it out')).toBeTruthy();
  const gas = screen.getByLabelText('Gas for action 5');
  fireEvent.change(gas, { target: { value: '40000000' } });
  await act(async () => {
    fireEvent.click(screen.getByText('Carry it out'));
  });
  expect(performAction).toHaveBeenCalledWith(
    expect.anything(),
    SAFE,
    5,
    40000000n
  );
});
