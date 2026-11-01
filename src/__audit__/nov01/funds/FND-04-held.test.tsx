// FND-04 on the card: a source whose code was read and has no upgrade function
// cannot succeed, so Sign and Carry it out are held, as for code nobody read.
// Discard and Remove my signature stay, so a board can clear such an action.
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);

import '../../display/restoreSetImmediate';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen } from '@testing-library/react';
import { codeHashOf } from 'multisig/legacyCalls';
import {
  ALICE,
  BOB,
  CAROL,
  networkMock,
  SAFE,
  useChain
} from '../../display/fixtures';
import { connectAs, renderSafe } from '../../display/renderSafe';

const SOURCE = 'erd1qqqqqqqqqqqqqpgqsy2ept5xx2cprx3htj0l5lwkk52hh9amxezsygtpgl';
const TARGET = 'erd1qqqqqqqqqqqqqpgqntmhxqa29ar4juhlprjjxaq790ykcj3uaujq2l9dzg';

// A minimal wasm exporting init and upgrade.
const WITH_UPGRADE = Uint8Array.from(
  Buffer.from(
    '0061736d01000000010401600000030302000007120204696e69740000077570677261646500010a070202000b02000b',
    'hex'
  )
);
// The legacy multisig: its endpoints, and no upgrade.
const NO_UPGRADE = new Uint8Array(
  readFileSync(join(__dirname, '../../../../public/contracts/multisig.wasm'))
);

const running = (code: Uint8Array, owner: string, upgradeable: boolean) => ({
  balance: '0',
  ownerAddress: owner,
  code: Buffer.from(code).toString('hex'),
  codeHash: Buffer.from(codeHashOf(code), 'hex').toString('base64'),
  isUpgradeable: upgradeable,
  isReadable: true,
  isPayable: false,
  isPayableBySmartContract: false
});

const baseApi = networkMock.api;
const sourceRuns = (code: Uint8Array) => {
  (networkMock as any).api = async (path: string) => {
    if (path === `/accounts/${SOURCE}`) return running(code, ALICE, false);
    if (path === `/accounts/${TARGET}`) {
      return running(WITH_UPGRADE, SAFE, true);
    }
    return baseApi(path);
  };
};
afterEach(() => {
  (networkMock as any).api = baseApi;
});

const upgrade = {
  kind: 'SCUpgradeFromSource' as const,
  scAddress: TARGET,
  source: SOURCE
};

beforeEach(() => {
  connectAs(BOB);
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: [
      // Unsigned: Sign and Discard.
      { id: 1, action: upgrade, signers: [] },
      // Ready, and signed by the viewer: Remove my signature and Carry it out.
      { id: 2, action: upgrade, signers: [ALICE, BOB] }
    ]
  });
});

const button = (name: string) =>
  screen.getByRole('button', { name }) as HTMLButtonElement;
// Newest first, so the last Discard is #1's, which carries no signature.
const firstDiscard = () => {
  const discards = screen.getAllByRole('button', { name: 'Discard' });
  return discards[discards.length - 1] as HTMLButtonElement;
};

test('control: a source with an upgrade function offers Sign and Carry it out', async () => {
  sourceRuns(WITH_UPGRADE);
  await renderSafe(SAFE);
  expect(screen.queryAllByText(/has no upgrade function/)).toEqual([]);
  expect(button('Sign').disabled).toBe(false);
  expect(button('Carry it out').disabled).toBe(false);
  expect(firstDiscard().disabled).toBe(false);
});

test('a source without one holds Sign and Carry it out, and leaves the way to clear it', async () => {
  sourceRuns(NO_UPGRADE);
  await renderSafe(SAFE);
  expect(screen.getAllByText(/has no upgrade function/).length).toBe(2);
  expect(button('Sign').disabled).toBe(true);
  expect(button('Carry it out').disabled).toBe(true);
  expect(firstDiscard().disabled).toBe(false);
  expect(button('Remove my signature').disabled).toBe(false);
});
