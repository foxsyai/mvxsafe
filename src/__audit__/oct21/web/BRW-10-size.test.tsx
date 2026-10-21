// BRW-10, the second half of the fix (main session, 21 Oct 2026): a file whose
// deploy could never fit in a transaction is refused before it is read or
// hashed, with a sentence, instead of freezing the tab.
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);
jest.mock('multisig/actions', () => ({
  deploySource: jest.fn(async () => '')
}));
jest.mock('multisig/legacyCalls', () => {
  const actual = jest.requireActual('multisig/legacyCalls');
  return { ...actual, codeHashOf: jest.fn(actual.codeHashOf) };
});

import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DeploySource } from 'components/Propose/DeploySource';
import { codeHashOf } from 'multisig/legacyCalls';
import { ALICE, SAFE } from '../../display/fixtures';

const pick = async (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x00, 0x61, 0x73, 0x6d]);
  const file = new File([bytes], 'big.wasm');
  const arrayBuffer = jest.fn(async () => bytes.buffer);
  (file as any).arrayBuffer = arrayBuffer;
  await act(async () => {
    fireEvent.change(
      document.querySelector('input[type=file]') as HTMLInputElement,
      { target: { files: [file] } }
    );
  });
  return arrayBuffer;
};

beforeEach(() => {
  (codeHashOf as jest.Mock).mockClear();
  render(
    <DeploySource
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      onUse={jest.fn()}
    />
  );
});

test('control: a contract-sized file is read and hashed', async () => {
  const read = await pick(100_000);
  expect(read).toHaveBeenCalled();
  expect(codeHashOf).toHaveBeenCalled();
});

test('a file too large to ever deploy is refused unread and unhashed', async () => {
  const read = await pick(5_000_000);
  expect(
    screen.getByText(/more gas than a transaction can carry/)
  ).toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
  expect(codeHashOf).not.toHaveBeenCalled();
});
