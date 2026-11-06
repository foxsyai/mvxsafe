// VFM-01: the Cancel form and the holdings list at most 100 of the safe's
// cancel keys (vestings-from-a-safe audit, 6 Nov 2026).
//
// readHeldCancelKeys (multisig/vestingReads.ts) asks the API once, with
// `size=100` and no paging. The API serves up to 10,000 in one page, or more
// in pages with `from`. A safe that created more than 100 cancelable vestings
// holds more than 100 keys: the Cancel form then offers the first 100 only,
// and the holdings say "mvxvest cancel keys: 100". The docs promise "The
// form lists the cancel keys the safe holds" and "The safe's holdings list
// its mvxvest cancel keys". The board cannot cancel the 101st vesting from
// the form, and reads a wrong count of what the safe controls.
//
// The network mock below serves pages the way the real API does (`from`,
// `size`, at most 10,000 in a window), so any fix that reads them all passes:
// one page of 10,000, or several pages.
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
        if (from + size > 10000) throw new Error(`${path} answered 400`);
        const wanted = (params.get('collections') ?? '').split(',');
        return mockHeld.keys
          .filter((key) => wanted.includes(key.collection))
          .slice(from, from + size);
      }
      if (/^\/accounts\/[^/?]+\/nfts\/count/.test(path))
        return mockHeld.keys.length;
      return base.api(path);
    },
    networkProvider: {
      ...base.networkProvider,
      queryContract: async (query: { function: string }) => {
        const answers: Record<string, Uint8Array[]> = {
          isCreationPaused: [new Uint8Array(0)],
          getClaimKeyCollection: [utf8('VESTKEY-8f217c')],
          getCancelKeyCollection: [utf8('VESTCANCEL-bd731d')],
          getFee: [new Uint8Array(0)],
          getTokenFee: [new Uint8Array(0)],
          // 0: mvxvest knows no vesting for the key. The count is what this
          // finding is about.
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
import { render, screen, waitFor } from '@testing-library/react';
import { HeldCancelKeys } from 'components/Pending/HeldCancelKeys';
import { CancelVestingForm } from 'components/Propose/CancelVestingForm';
import { keyIdentifier, mvxvestFor } from 'multisig/vesting';
import { readHeldCancelKeys } from 'multisig/vestingReads';
import { ALICE, SAFE } from '../../display/fixtures';

const pin = mvxvestFor('devnet')!;

/** What the safe holds of mvxvest's cancel keys, as the API lists them. */
const mockHeld: {
  keys: { identifier: string; nonce: number; collection: string }[];
} = { keys: [] };

const holding = (count: number) => {
  mockHeld.keys = Array.from({ length: count }, (_, at) => ({
    identifier: keyIdentifier(pin.cancelKey, at + 1),
    nonce: at + 1,
    collection: pin.cancelKey
  }));
};

const renderForm = () =>
  render(
    <CancelVestingForm
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      onProposed={() => undefined}
    />
  );

describe('VFM-01: every cancel key the safe holds is listed, not the first 100', () => {
  it('control: a safe with 60 keys has all 60 offered in the Cancel form', async () => {
    holding(60);
    renderForm();
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(60));
  });

  it('reads all 150 keys of a safe that holds 150', async () => {
    holding(150);
    const keys = await readHeldCancelKeys(pin, SAFE);
    expect(keys).toHaveLength(150);
    expect(keys.map((key) => key.nonce)).toContain(150);
  });

  it('the Cancel form offers all 150 keys, so the 101st vesting can be cancelled from it', async () => {
    holding(150);
    renderForm();
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(150));
  });

  it('the holdings count all 150 keys', async () => {
    holding(150);
    render(
      <ul>
        <HeldCancelKeys safe={SAFE} nftCount={150} />
      </ul>
    );
    const line = await screen.findByText(/mvxvest cancel keys: \d+/);
    expect(line.textContent).toContain('mvxvest cancel keys: 150');
  });
});
