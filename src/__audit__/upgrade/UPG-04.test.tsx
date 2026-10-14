// UPG-04: the call form's Propose button is enabled while the call has NOT
// been tried as the safe yet. `blocked` is `trial?.tone === 'bad'`, and `trial`
// is reset to null the moment any input changes, then only set 700 ms after
// the typing stops plus however long the network takes. In that window the
// button is live, so "A call the contract refuses is not proposed" (the form's
// own promise) holds only for a proposer who waits. Paste, click: the proposal
// of a failing call reaches the wallet with nothing tried.
jest.mock(
  'multisig/network',
  () => require('../../multisig/tests/contractsMock').contractsNetworkMock
);
jest.mock('multisig/actions', () => ({
  proposeCall: jest.fn(async () => 'session')
}));

import '../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { CallForm } from 'components/Propose/CallForm';
import { proposeCall } from 'multisig/actions';
import { predictSafeAddress } from 'multisig/legacyCalls';
import {
  contract,
  mockAccounts,
  mockTrial
} from '../../multisig/tests/contractsMock';
import { ALICE, CAROL, SAFE } from '../display/fixtures';

const TARGET = predictSafeAddress(CAROL, 40);
const signer = { address: ALICE, nonce: 1 };

const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value }
  });
const propose = () => screen.getByRole('button', { name: 'Propose' });

const fill = () => {
  render(<CallForm safe={SAFE} signer={signer} onProposed={jest.fn()} />);
  type('erd1qqqqqqqqqqqqqpgq...', TARGET);
  type('setFee', 'setFee');
  fireEvent.click(screen.getByText('+ add an argument'));
  fireEvent.change(screen.getByLabelText('Kind of argument'), {
    target: { value: 'egld' }
  });
  fireEvent.change(screen.getByLabelText('Argument 1'), {
    target: { value: '0.01' }
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: '11'.repeat(32) });
});

describe('control', () => {
  test('once the trial has answered that the call works, Propose is enabled and proposes', async () => {
    mockTrial.answer = async () => ({ gasLimit: 3800000 });
    fill();
    expect(
      await screen.findByText(
        /it works, and needs 3,800,000 gas/,
        {},
        { timeout: 3000 }
      )
    ).toHaveAttribute('data-tone', 'ok');
    expect(propose()).toBeEnabled();
    await act(async () => {
      fireEvent.click(propose());
    });
    expect(proposeCall).toHaveBeenCalledTimes(1);
  });
});

describe('before the trial has answered', () => {
  test('right after typing, before the 700 ms wait, nothing has been tried: Propose must be disabled', async () => {
    mockTrial.answer = () => new Promise(() => undefined); // the network has not answered yet
    fill();
    expect(screen.queryByText(/Tried just now/)).toBeNull();
    expect(propose()).toBeDisabled();
  });

  test('while the network is trying the call, Propose must stay disabled', async () => {
    mockTrial.answer = () => new Promise(() => undefined);
    fill();
    await screen.findByText(
      'Trying it as the safe would send it...',
      {},
      { timeout: 3000 }
    );
    expect(propose()).toBeDisabled();
  });

  test('a call the contract refused, then edited: Propose must not come back before the new trial', async () => {
    const { ErrEstimateTransactionCost } = jest.requireActual(
      '@multiversx/sdk-core'
    );
    mockTrial.answer = async () => {
      throw new ErrEstimateTransactionCost('user error: fee above the maximum');
    };
    fill();
    expect(
      await screen.findByText(/the call FAILS/, {}, { timeout: 3000 })
    ).toHaveAttribute('data-tone', 'bad');
    expect(propose()).toBeDisabled();
    // The proposer changes the amount; the contract would refuse this one too,
    // but the trial is pending again.
    mockTrial.answer = () => new Promise(() => undefined);
    fireEvent.change(screen.getByLabelText('Argument 1'), {
      target: { value: '0.02' }
    });
    expect(propose()).toBeDisabled();
    await waitFor(() => expect(propose()).toBeDisabled());
    expect(proposeCall).not.toHaveBeenCalled();
  });
});
