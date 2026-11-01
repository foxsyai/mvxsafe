// RED-04 (redteam audit, 1 Nov 2026): the EXT-01 hold has a way round. When
// the API states a code hash but returns no code, the card holds Sign and
// Carry it out (codeUnread, PR #17). When the read of the source FAILS
// outright (a 500, a timeout, a dropped connection, a 429 past the retries),
// inspectUpgrade catches it, says in amber "could not be read just now ...
// Refresh before signing", shows "none" for both hashes, and leaves Sign
// enabled. The signer then approves an upgrade whose code nobody on this page
// has seen. A pasted release hash answers red ("has no code hash to compare
// with"), but nothing is held.
//
// The chain: one stolen key proposes the upgrade of the vesting contract from
// a malicious source; the second signer opens the card on a bad connection or
// in a moment the API refuses the account read (the page's own reads of the
// safe may well succeed, they are contract queries, not account reads), sees
// the amber line, and signs. The same page would have refused the same action
// had the API answered with the hash and no code.
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);

import '../../display/restoreSetImmediate';
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

// The devnet rehearsal's contracts, from docs/upgrade-and-calls.md: the
// source in the safe's shard, the owned contract in shard 0.
const SOURCE = 'erd1qqqqqqqqqqqqqpgqsy2ept5xx2cprx3htj0l5lwkk52hh9amxezsygtpgl';
const TARGET = 'erd1qqqqqqqqqqqqqpgqntmhxqa29ar4juhlprjjxaq790ykcj3uaujq2l9dzg';

// A minimal wasm exporting init and upgrade.
const CODE =
  '0061736d01000000010401600000030302000007120204696e69740000077570677261646500010a070202000b02000b';
const codeHash = Buffer.from(
  codeHashOf(Uint8Array.from(Buffer.from(CODE, 'hex'))),
  'hex'
).toString('base64');

const baseApi = networkMock.api;
const accounts = (sourceFails: boolean) => {
  (networkMock as any).api = async (path: string) => {
    if (path === `/accounts/${SOURCE}`) {
      if (sourceFails) throw new Error(`${path} answered 500`);
      return {
        balance: '0',
        ownerAddress: ALICE,
        code: CODE,
        codeHash,
        isUpgradeable: false,
        isReadable: true,
        isPayable: false,
        isPayableBySmartContract: false
      };
    }
    if (path === `/accounts/${TARGET}`) {
      return {
        balance: '0',
        ownerAddress: SAFE,
        code: CODE,
        codeHash,
        isUpgradeable: true,
        isReadable: true,
        isPayable: false,
        isPayableBySmartContract: false
      };
    }
    return baseApi(path);
  };
};
afterEach(() => {
  (networkMock as any).api = baseApi;
});

beforeEach(() => {
  connectAs(BOB);
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: [
      {
        id: 1,
        action: {
          kind: 'SCUpgradeFromSource',
          scAddress: TARGET,
          source: SOURCE
        },
        signers: [ALICE]
      }
    ]
  });
});

test('control: an upgrade whose source and target were read offers Sign', async () => {
  accounts(false);
  await renderSafe(SAFE);
  expect(
    screen.getByText(/The safe owns the contract, so it may upgrade it/)
  ).toBeTruthy();
  expect((screen.getByText('Sign') as HTMLButtonElement).disabled).toBe(false);
});

test('an upgrade whose source could not be read at all is held like one whose code was not returned', async () => {
  accounts(true);
  await renderSafe(SAFE);
  // The amber line is there...
  expect(screen.getByText(/could not be read just now/)).toBeTruthy();
  // ...and so is a live Sign button. EXT-01 holds it when the API states a
  // hash without the code; a read that fails leaves the code just as unseen.
  const sign = screen.queryByText('Sign') as HTMLButtonElement | null;
  expect(sign === null || sign.disabled).toBe(true);
});
