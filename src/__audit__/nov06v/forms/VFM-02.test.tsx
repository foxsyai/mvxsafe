// VFM-02: a key whose vesting could not be read is shown as "mvxvest knows no
// vesting for this key" (vestings-from-a-safe audit, 6 Nov 2026).
//
// readHeldCancelKeys (multisig/vestingReads.ts) reads the vesting behind
// each key with readVestingOfCancelKey(...).catch(() => null). Null is also
// what it returns when mvxvest answers that the key opens no vesting. So a
// 429, a timeout or a node that is down reads, in the Cancel form and in the
// holdings, as "mvxvest knows no vesting for this key": a false statement to
// the board about what the safe controls, with the key greyed out so it
// cannot be chosen. The views behind it do not go through the app's paced
// queue (network.ts: four a second, three at a time, 429 pauses the queue):
// readHeldCancelKeys fires two unpaced queries per key at once, so with a few
// dozen keys the public API's rate limit makes this the usual case, not a
// rare one. The card of a pending cancel does not have this problem: it lets
// the failure through and says the checks could not be run.
//
// The fix: let a failed read fail (the form already says "could not be read
// just now" for that, and the holdings "could not be read just now"), or mark
// the key as unread and say so; and pace the views like every other read.
jest.mock('multisig/network', () => {
  const base = require('../../display/fixtures').networkMock;
  const utf8 = (text: string) => new TextEncoder().encode(text);
  return {
    ...base,
    api: async (path: string) => {
      const nfts = /^\/accounts\/[^/?]+\/nfts\?(.*)$/.exec(path);
      if (nfts) {
        const params = new URLSearchParams(nfts[1]);
        const size = Number(params.get('size') ?? 25);
        const from = Number(params.get('from') ?? 0);
        return mockHeld.keys.slice(from, from + size);
      }
      if (/^\/accounts\/[^/?]+\/nfts\/count/.test(path))
        return mockHeld.keys.length;
      return base.api(path);
    },
    networkProvider: {
      ...base.networkProvider,
      queryContract: async (query: { function: string }) => {
        if (mockHeld.failing.has(query.function))
          throw new Error(`${query.function} answered 429`);
        const answers: Record<string, Uint8Array[]> = {
          isCreationPaused: [new Uint8Array(0)],
          getClaimKeyCollection: [utf8('VESTKEY-8f217c')],
          getCancelKeyCollection: [utf8('VESTCANCEL-bd731d')],
          getFee: [new Uint8Array(0)],
          getTokenFee: [new Uint8Array(0)],
          getVestingByCancelNonce: [new Uint8Array(0)]
        };
        const parts = answers[query.function];
        if (!parts) throw new Error(`no answer for ${query.function}`);
        return {
          function: query.function,
          returnCode: 'ok',
          returnMessage: '',
          returnDataParts: parts
        };
      }
    }
  };
});
jest.mock('multisig/actions', () => ({
  proposeCancelVesting: jest.fn(async () => 'session')
}));
jest.mock('multisig/vestingReads', () => ({
  ...jest.requireActual('multisig/vestingReads'),
  readVestingFacts: jest.fn(async () => ({
    codeHash:
      '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246',
    creationPaused: false,
    claimKeyIssued: true,
    cancelKeyIssued: true,
    claimKeyCollection: 'VESTKEY-8f217c',
    cancelKeyCollection: 'VESTCANCEL-bd731d',
    fee: 0n,
    tokenFeeBps: 0,
    safePayableBySc: true,
    safeBalance: 0n,
    safeEgld: 10n ** 18n
  }))
}));

import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { HeldCancelKeys } from 'components/Pending/HeldCancelKeys';
import { CancelVestingForm } from 'components/Propose/CancelVestingForm';
import { keyIdentifier, mvxvestFor } from 'multisig/vesting';
import { ALICE, SAFE } from '../../display/fixtures';

const pin = mvxvestFor('devnet')!;

const mockHeld: {
  keys: { identifier: string; nonce: number; collection: string }[];
  failing: Set<string>;
} = { keys: [], failing: new Set() };

beforeEach(() => {
  mockHeld.keys = [1, 2].map((nonce) => ({
    identifier: keyIdentifier(pin.cancelKey, nonce),
    nonce,
    collection: pin.cancelKey
  }));
  mockHeld.failing = new Set();
});

const settle = async () => {
  // The reads chain several promises; let them all settle.
  for (let round = 0; round < 6; round++) await act(async () => undefined);
};

const renderForm = async () => {
  render(
    <CancelVestingForm
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      onProposed={() => undefined}
    />
  );
  await settle();
};

describe('VFM-02: a vesting that could not be read is never "no vesting"', () => {
  it('control: when mvxvest answers that a key opens no vesting, the form says so', async () => {
    await renderForm();
    expect(
      screen.getAllByText(/mvxvest knows no vesting for this key/).length
    ).toBe(2);
  });

  it('the Cancel form: a view that answers 429 is "could not be read", not "knows no vesting"', async () => {
    mockHeld.failing = new Set(['getVestingByCancelNonce']);
    await renderForm();
    expect(screen.queryAllByText(/knows no vesting/)).toHaveLength(0);
    // One line per key that could not be read (the fix carries an unread
    // state per key, one of the two fixes this report proposed).
    expect(screen.getAllByText(/could not be read/).length).toBeGreaterThan(0);
  });

  it('the holdings: the same', async () => {
    mockHeld.failing = new Set(['getVestingByCancelNonce']);
    render(
      <ul>
        <HeldCancelKeys safe={SAFE} nftCount={2} />
      </ul>
    );
    await settle();
    expect(screen.queryAllByText(/knows no vesting/)).toHaveLength(0);
    // One line per key that could not be read (the fix carries an unread
    // state per key, one of the two fixes this report proposed).
    expect(screen.getAllByText(/could not be read/).length).toBeGreaterThan(0);
  });
});
