/**
 * @jest-environment node
 */
// VFM-05: the cancel keys' vestings are read in one unpaced burst
// (vestings-from-a-safe audit, 6 Nov 2026).
//
// multisig/network.ts paces every read of this app: the public API allows
// about two requests a second from one visitor, bursts beyond that tripped
// its limit "again and again" on 7 Oct 2026, so reads go through a queue
// (four a second, three at a time, a 429 pauses the whole queue) and every
// contract view in reads.ts and inspect.ts goes through `cached`. The views
// in multisig/vestingReads.ts do not: `view` calls the controller directly.
// readHeldCancelKeys then reads the vesting behind every key with
// Promise.all, two views a key: thirty keys are sixty queries fired at once,
// every one of them outside the queue. The refusals that follow are what
// VFM-02 then shows as "mvxvest knows no vesting for this key".
//
// This test gives the reads a `cached` that is a three-slot gate, as the real
// one is, and counts how many views are in flight at once. Reads that go
// through the gate, or that otherwise keep to the app's limit, pass.
jest.mock('multisig/network', () => {
  const base = require('../../display/fixtures').networkMock;
  const utf8 = (text: string) => new TextEncoder().encode(text);
  let slots = 0;
  const waiting: (() => void)[] = [];
  const take = () =>
    new Promise<void>((resolve) => {
      if (slots < 3) {
        slots++;
        resolve();
      } else waiting.push(resolve);
    });
  const give = () => {
    const next = waiting.shift();
    if (next) next();
    else slots--;
  };
  return {
    ...base,
    cached: async <T>(_key: string, work: () => Promise<T>): Promise<T> => {
      await take();
      try {
        return await work();
      } finally {
        give();
      }
    },
    api: async (path: string) => {
      if (/^\/accounts\/[^/?]+\/nfts\?/.test(path)) return mockHeld.keys;
      return base.api(path);
    },
    networkProvider: {
      ...base.networkProvider,
      queryContract: async (query: { function: string }) => {
        mockHeld.inFlight++;
        mockHeld.mostInFlight = Math.max(
          mockHeld.mostInFlight,
          mockHeld.inFlight
        );
        // A view takes a moment to answer, as on the real network.
        await new Promise((resolve) => setTimeout(resolve, 5));
        mockHeld.inFlight--;
        const answers: Record<string, Uint8Array[]> = {
          getClaimKeyCollection: [utf8('VESTKEY-8f217c')],
          getCancelKeyCollection: [utf8('VESTCANCEL-bd731d')],
          getVestingByCancelNonce: [new Uint8Array(0)]
        };
        const parts = answers[query.function] ?? [new Uint8Array(0)];
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

import { keyIdentifier, mvxvestFor } from 'multisig/vesting';
import { readHeldCancelKeys } from 'multisig/vestingReads';
import { SAFE } from '../../display/fixtures';

const pin = mvxvestFor('devnet')!;

const mockHeld: {
  keys: { identifier: string; nonce: number }[];
  inFlight: number;
  mostInFlight: number;
} = { keys: [], inFlight: 0, mostInFlight: 0 };

const holding = (count: number) => {
  mockHeld.keys = Array.from({ length: count }, (_, at) => ({
    identifier: keyIdentifier(pin.cancelKey, at + 1),
    nonce: at + 1
  }));
  mockHeld.inFlight = 0;
  mockHeld.mostInFlight = 0;
};

describe('VFM-05: the keys are read at the pace the app keeps everywhere', () => {
  it('control: one key makes one view at a time', async () => {
    holding(1);
    const keys = await readHeldCancelKeys(pin, SAFE);
    expect(keys).toHaveLength(1);
    expect(mockHeld.mostInFlight).toBeLessThanOrEqual(3);
  });

  it('thirty keys never have more than three views in flight', async () => {
    holding(30);
    const keys = await readHeldCancelKeys(pin, SAFE);
    expect(keys).toHaveLength(30);
    expect(mockHeld.mostInFlight).toBeLessThanOrEqual(3);
  });
});
