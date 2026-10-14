// UPG-06: the tip on "Deploy the source" says the deploy "costs about 0.04 EGLD
// for a 26 KB contract". A deploy carries the whole code as hex in its data,
// two characters a byte at 1,500 gas each, paid in full at the minimum gas
// price: for 26,540 bytes that is 79.6M gas before anything runs, 0.0796 EGLD.
// The rehearsal's own deploy of exactly that contract (devnet transaction
// 861359d3..., 53,090 bytes of data, 105,538,856 gas) cost 0.0799 EGLD, twice
// the figure the tip gives whoever is about to sign it.
import '../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DeploySource } from 'components/Propose/DeploySource';
import { feeOf } from 'multisig/gas';
import { ALICE, SAFE } from '../display/fixtures';

jest.mock(
  'multisig/network',
  () => require('../../multisig/tests/contractsMock').contractsNetworkMock
);
jest.mock('multisig/actions', () => ({ deploySource: jest.fn() }));

const signer = { address: ALICE, nonce: 1 }; // shard 1, the safe's

const pick = async (bytes: Uint8Array) => {
  const file = new File([bytes as unknown as BlobPart], 'release.wasm');
  (file as any).arrayBuffer = async () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await act(async () => {
    fireEvent.change(
      document.querySelector('input[type=file]') as HTMLInputElement,
      { target: { files: [file] } }
    );
  });
};

/** The EGLD figure the tip under "Deploy the source" states. */
const statedCost = () => {
  const button = screen.getByRole('button', { name: 'Deploy the source' });
  fireEvent.mouseEnter(button.parentElement as HTMLElement);
  const tip = screen.getByRole('tooltip').textContent ?? '';
  const match = /about ([\d.]+) EGLD/.exec(tip);
  if (!match) throw new Error(`no cost in the tip: "${tip}"`);
  return Number(match[1]);
};

/** What the data alone costs, at the minimum price, before the code runs: a floor. */
const dataFloor = (bytes: number) => {
  const dataLength = 2 * bytes + '@0500@0400'.length;
  return Number(feeOf(50000n + 1500n * BigInt(dataLength), dataLength)) / 1e18;
};

test('control: the tip states a cost in EGLD', async () => {
  render(<DeploySource safe={SAFE} signer={signer} onUse={jest.fn()} />);
  expect(statedCost()).toBeGreaterThan(0);
});

test('the shipped multisig (23,582 bytes): the stated cost is at least what its data alone costs', async () => {
  const wasm = new Uint8Array(
    readFileSync(join(__dirname, '../../../public/contracts/multisig.wasm'))
  );
  render(<DeploySource safe={SAFE} signer={signer} onUse={jest.fn()} />);
  await pick(wasm);
  expect(statedCost()).toBeGreaterThanOrEqual(dataFloor(wasm.length));
});

test('a 100,000-byte contract: the stated cost is at least what its data alone costs (0.3 EGLD)', async () => {
  const big = new Uint8Array(100000);
  big.set([0x00, 0x61, 0x73, 0x6d]);
  render(<DeploySource safe={SAFE} signer={signer} onUse={jest.fn()} />);
  await pick(big);
  expect(dataFloor(big.length)).toBeGreaterThan(0.3);
  expect(statedCost()).toBeGreaterThanOrEqual(dataFloor(big.length));
});
