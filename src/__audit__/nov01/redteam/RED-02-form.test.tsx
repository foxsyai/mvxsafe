// RED-02 on the Call form (redteam audit, 1 Nov 2026): a board member can
// propose the EGLD sink from the shipped form. The safe's own address is a
// contract address, dnsRegister is not a built-in, the trial as the safe
// answers 600,000,001 (what devnet answers for this self-call, see
// proofs/RED-02.mjs), which the form reads as "could not try it: another
// shard", amber. Under the sentence "on this safe itself, sending 0.01 EGLD
// with it" the form says, in green, "The safe owns this contract." and offers
// Propose.
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);
jest.mock('multisig/actions', () => ({
  proposeCall: jest.fn(async () => 'session')
}));

import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CallForm } from 'components/Propose/CallForm';
import { predictSafeAddress } from 'multisig/legacyCalls';
import {
  contract,
  mockAccounts,
  mockCode,
  mockTrial
} from '../../../multisig/tests/contractsMock';
import { ALICE, CAROL, SAFE } from '../../display/fixtures';

const OWNED = predictSafeAddress(CAROL, 40);

const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 1500)));

const fill = async ({
  to,
  name,
  egld,
  args
}: {
  to: string;
  name: string;
  egld: string;
  args: { kind: string; value: string }[];
}) => {
  render(
    <CallForm
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      onProposed={jest.fn()}
    />
  );
  fireEvent.change(screen.getByPlaceholderText('erd1qqqqqqqqqqqqqpgq...'), {
    target: { value: to }
  });
  fireEvent.change(screen.getByPlaceholderText('setFee'), {
    target: { value: name }
  });
  for (const [at, argument] of args.entries()) {
    fireEvent.click(screen.getByText('+ add an argument'));
    fireEvent.change(screen.getAllByLabelText('Kind of argument')[at], {
      target: { value: argument.kind }
    });
    fireEvent.change(screen.getByLabelText(`Argument ${at + 1}`), {
      target: { value: argument.value }
    });
  }
  fireEvent.change(screen.getByPlaceholderText('0'), {
    target: { value: egld }
  });
  await settle();
};

beforeEach(() => {
  mockAccounts[SAFE] = contract({ owner: SAFE, hash: mockCode('the safe') });
  mockAccounts[OWNED] = contract({ owner: SAFE, hash: mockCode('owned') });
});

test('control: setFee on an owned contract, tried and measured, offers Propose', async () => {
  mockTrial.answer = async () => ({ gasLimit: 3800000 });
  await fill({
    to: OWNED,
    name: 'setFee',
    egld: '',
    args: [{ kind: 'egld', value: '0.01' }]
  });
  expect(screen.getByText(/it works and needs/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Propose' })).toBeEnabled();
});

test('dnsRegister on the safe itself with 0.01 EGLD is not offered as a proposal', async () => {
  // What devnet answers the trial for this very call (proofs/RED-02.mjs).
  mockTrial.answer = async () => ({ gasLimit: 600000001 });
  await fill({
    to: SAFE,
    name: 'dnsRegister',
    egld: '0.01',
    args: [
      { kind: 'address', value: ALICE },
      { kind: 'text', value: 'zzzname' }
    ]
  });
  // Today: the sentence below, green "The safe owns this contract.", an amber
  // trial line, and Propose enabled.
  expect(screen.getByRole('button', { name: 'Propose' })).toBeDisabled();
});
