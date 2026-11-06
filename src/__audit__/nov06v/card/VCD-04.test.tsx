// VCD-04: a safe holding more than 100 cancel keys sees 100, and can cancel
// only those.
//
// readHeldCancelKeys asks the API for the safe's keys of the pinned cancel
// collection with size=100 and no paging. The API serves up to 10,000 in one
// page (from + size <= 10000) and pages with `from`. A safe that has created
// more than 100 cancelable vestings (four batches of 32 are 128) holds more
// keys than that. The holdings say "mvxvest cancel keys: 100", and the Cancel
// a vesting form, which lists the same read, cannot cancel any vesting whose
// key is past the hundredth: the call form refuses every token transfer, so
// from mvxsafe those vestings cannot be cancelled at all.
//
// Expected: every key the safe holds is read, by paging or a larger page.
jest.mock('multisig/network', () => {
  const base = require('../../display/fixtures').networkMock;
  return {
    ...base,
    api: async (path: string) => {
      const list = /^\/accounts\/[^/]+\/nfts\?(.*)$/.exec(path);
      if (list) {
        const params = new URLSearchParams(list[1]);
        const from = Number(params.get('from') ?? 0);
        const size = Number(params.get('size') ?? 25);
        // As the real API answers: a window beyond 10,000 is refused.
        if (from + size > 10000)
          throw new Error(
            'Result window is too large, from + size must be less than or equal to: [10000]'
          );
        return mockKeys.slice(from, from + size);
      }
      if (/^\/accounts\/[^/]+\/nfts\/count/.test(path)) return mockKeys.length;
      return base.api(path);
    }
  };
});

import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { HeldCancelKeys } from 'components/Pending/HeldCancelKeys';
import { mvxvestFor } from 'multisig/vesting';
import { readHeldCancelKeys } from 'multisig/vestingReads';
import { SAFE } from '../../display/fixtures';

const pin = mvxvestFor('devnet')!;
const HELD = 150;
const keyOf = (nonce: number) => ({
  identifier: `${pin.cancelKey}-${nonce.toString(16).padStart(2, '0')}`,
  collection: pin.cancelKey,
  nonce
});
const mockKeys = Array.from({ length: HELD }, (_, at) => keyOf(at + 1));

describe('VCD-04: a safe with more than 100 cancel keys', () => {
  it('control: the API fixture pages like the real one', async () => {
    const { api } = jest.requireMock('multisig/network');
    expect(
      await api(`/accounts/${SAFE}/nfts?collections=${pin.cancelKey}&size=100`)
    ).toHaveLength(100);
    expect(
      await api(
        `/accounts/${SAFE}/nfts?collections=${pin.cancelKey}&from=100&size=100`
      )
    ).toHaveLength(50);
  });

  it('reads every key the safe holds', async () => {
    const keys = await readHeldCancelKeys(pin, SAFE);
    expect(keys).toHaveLength(HELD);
    expect(keys.map((key) => key.nonce)).toContain(HELD);
  });

  it('the holdings count every key', async () => {
    render(<HeldCancelKeys safe={SAFE} nftCount={HELD} />);
    expect(
      await screen.findByText(/mvxvest cancel keys:/, {}, { timeout: 8000 })
    ).toHaveTextContent(`mvxvest cancel keys: ${HELD}`);
  });
});
