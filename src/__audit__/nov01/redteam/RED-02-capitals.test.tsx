// Review of PR #20: bech32 allows capitals, parseAddress accepts them, and the
// Call form compared the raw text. The safe's own address in capitals got past
// the refusal of a self-call, and a system contract's sentence went undecoded.
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
import { ALICE, CAROL, ESDT_SYSTEM_SC, SAFE } from '../../display/fixtures';

const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 1000)));

const fill = async (to: string, name: string) => {
  render(
    <CallForm
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      onProposed={jest.fn()}
    />
  );
  fireEvent.change(screen.getByPlaceholderText(/^erd1/), {
    target: { value: to }
  });
  fireEvent.change(screen.getByPlaceholderText(/function|setFee/i), {
    target: { value: name }
  });
  await settle();
};

beforeEach(() => {
  mockAccounts[SAFE] = contract({ owner: SAFE, hash: mockCode('the safe') });
  mockTrial.answer = async () => ({ gasLimit: 3800000 });
});

test('the safe in capitals is the safe: refused', async () => {
  await fill(SAFE.toUpperCase(), 'dnsRegister');
  expect(screen.getByText(/This is the safe itself/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /propose/i })).toBeDisabled();
});

test('with spaces around it too', async () => {
  await fill(`  ${SAFE.toUpperCase()} `, 'dnsRegister');
  expect(screen.getByText(/This is the safe itself/)).toBeInTheDocument();
});

test('control: another contract in capitals is not the safe', async () => {
  const owned = predictSafeAddress(CAROL, 40);
  mockAccounts[owned] = contract({ owner: SAFE, hash: mockCode('owned') });
  await fill(owned.toUpperCase(), 'setFee');
  expect(screen.queryByText(/This is the safe itself/)).toBeNull();
  expect(screen.getByText('The safe owns this contract.')).toBeInTheDocument();
});

test('the system contract in capitals reads the same as in small letters', async () => {
  const sentence = async (to: string) => {
    const view = render(
      <CallForm
        safe={SAFE}
        signer={{ address: ALICE, nonce: 1 }}
        onProposed={jest.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/^erd1/), {
      target: { value: to }
    });
    fireEvent.change(screen.getByPlaceholderText(/function|setFee/i), {
      target: { value: 'pause' }
    });
    await settle();
    const found = view.container.textContent;
    view.unmount();
    return found?.replace(ESDT_SYSTEM_SC.toUpperCase(), ESDT_SYSTEM_SC);
  };
  expect(await sentence(ESDT_SYSTEM_SC.toUpperCase())).toBe(
    await sentence(ESDT_SYSTEM_SC)
  );
});
