/**
 * BRW-10: the deploy form hashes the whole .wasm file on every render.
 *
 * DeploySource (src/components/Propose/DeploySource.tsx) computes
 * `const hash = bytes ? codeHashOf(bytes) : null` in the render body, not in a
 * memo. Every keystroke in the expected-hash field, every tick of the
 * wallet-stuck timer and every poll after the deploy renders again and runs
 * blake2b over the file once more: 42 ms per megabyte on this machine, so a
 * file far larger than any contract (a wrong file picked by mistake, or on
 * purpose) makes the form stall for seconds at each character typed, before
 * the network ever refuses the oversized deploy. Self-inflicted, hence low; the
 * fix is one useMemo.
 *
 * Run, from the app folder: npx jest src/__audit__/oct21/web/BRW-10.test.tsx
 */
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
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DeploySource } from 'components/Propose/DeploySource';
import { codeHashOf } from 'multisig/legacyCalls';
import { ALICE, SAFE } from '../../display/fixtures';

const wasm = new Uint8Array(
  readFileSync(join(__dirname, '../../../../public/contracts/multisig.wasm'))
);
const hash = jest.requireActual('multisig/legacyCalls').codeHashOf(wasm);

const pick = async () => {
  const file = new File([wasm], 'multisig.wasm');
  // jsdom's File has no arrayBuffer().
  (file as any).arrayBuffer = async () =>
    wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
  await act(async () => {
    fireEvent.change(
      document.querySelector('input[type=file]') as HTMLInputElement,
      { target: { files: [file] } }
    );
  });
};

beforeEach(() => (codeHashOf as jest.Mock).mockClear());

test('control: the file is hashed once it is picked, and the hash is shown', async () => {
  render(
    <DeploySource
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      onUse={jest.fn()}
    />
  );
  await pick();
  expect(screen.getByText(hash)).toBeInTheDocument();
  expect(codeHashOf).toHaveBeenCalled();
});

test('typing the expected hash does not hash the file again at every character', async () => {
  render(
    <DeploySource
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      onUse={jest.fn()}
    />
  );
  await pick();
  const hashedAfterPick = (codeHashOf as jest.Mock).mock.calls.length;
  const field = screen.getByPlaceholderText(
    '64 hex characters from the release'
  );
  for (let length = 1; length <= 12; length++) {
    fireEvent.change(field, { target: { value: hash.slice(0, length) } });
  }
  const hashedWhileTyping =
    (codeHashOf as jest.Mock).mock.calls.length - hashedAfterPick;
  expect(hashedWhileTyping).toBe(0);
});
