/**
 * @jest-environment node
 *
 * FND-02: one rogue proposer (or board member) makes every page load of a safe
 * read its whole history one action at a time, for as long as the safe lives.
 *
 * Contract facts: only a board member or a proposer can propose, a proposal
 * costs its sender about 0.0001 EGLD in fees and needs nobody's signature, and
 * one proposal with an argument of about 12 KB makes getPendingActionFullInfo
 * fail for every reader (SC-01, 21 Oct 2026, still live on the devnet safe
 * erd1qqqqqqqqqqqqqpgqvhmkludyju7m9acwpfchadgeux9h0xa2mg8s523mc5). The 21 Oct
 * fix then reads the actions one by one: two queries per id over the WHOLE
 * history, in order, through a queue paced at four requests a second, and the
 * list is shown only once every id has answered. The finished ids it remembers
 * live in memory, so every reload starts again from id 1.
 *
 * So a rogue proposer files 3,000 junk proposals (about 0.3 EGLD) and one
 * poison, and from then on every board member waits about 25 minutes at every
 * load before a single pending action is shown, the poison's "Discard" and the
 * RemoveUser against the rogue included. The proposer can file a new poison the
 * moment the old one is discarded, for as long as they hold the role.
 *
 * Correct behaviour, asserted here: the newest pending action is listed after a
 * bounded number of reads, whatever the length of the history, so the board can
 * see and act on what matters (a RemoveUser for the rogue, for one) within a
 * minute rather than an hour.
 */
jest.mock('multisig/network', () => {
  const { networkMock } = require('../../display/fixtures');
  const { Address } = require('@multiversx/sdk-core');
  const { bigBytes, encodeAction } = require('../../display/fixtures');
  const ALICE =
    'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
  const LAST = 3000;
  const counts: Record<string, number> = ((globalThis as any).__fnd02 = {});
  const count = (fn: string) => (counts[fn] = (counts[fn] ?? 0) + 1);
  const idOf = (args: Uint8Array[]) =>
    args[0]?.length ? parseInt(Buffer.from(args[0]).toString('hex'), 16) : 0;
  const parts = (fn: string, returnDataParts: Uint8Array[]) => ({
    function: fn,
    returnCode: 'ok',
    returnMessage: '',
    returnDataParts
  });
  return {
    ...networkMock,
    networkProvider: {
      ...networkMock.networkProvider,
      queryContract: async (query: {
        function: string;
        arguments?: Uint8Array[];
      }) => {
        const { function: fn, arguments: args = [] } = query;
        count(fn);
        if (fn === 'getActionLastIndex')
          return parts(fn, [bigBytes(BigInt(LAST))]);
        // The node runs out of gas walking 3,000 pending actions.
        if (fn === 'getPendingActionFullInfo')
          throw new Error('execution failed: out of gas');
        if (fn === 'getActionData') {
          const id = idOf(args);
          // 2,999 junk proposals by the rogue proposer, unsigned; the newest is the board's own.
          return parts(fn, [
            encodeAction(
              id === LAST
                ? { kind: 'SendTransferExecute', to: ALICE, egld: 10n ** 15n }
                : { kind: 'ChangeQuorum', quorum: 2 }
            )
          ]);
        }
        // No signers comes back as one empty part, as the contract returns an empty List<Address>.
        if (fn === 'getActionSigners')
          return parts(fn, [
            idOf(args) === LAST
              ? Address.newFromBech32(ALICE).getPublicKey()
              : new Uint8Array(0)
          ]);
        return networkMock.networkProvider.queryContract(query);
      }
    }
  };
});

import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';

const counts = () => (globalThis as any).__fnd02 as Record<string, number>;
const reads = () =>
  (counts().getActionData ?? 0) + (counts().getActionSigners ?? 0);

beforeEach(() => {
  for (const key of Object.keys(counts())) delete counts()[key];
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [] });
});

test("control: the newest pending action, the board's own transfer, is listed", async () => {
  const list = await readPendingActions(SAFE);
  const transfer = list.find((action) => action.actionId === 3000)!;
  expect(transfer).toBeDefined();
  expect(transfer.description).toMatch(/EGLD/);
  expect(transfer.signerCount).toBe(1);
});

test('the newest pending action is found within a bounded number of reads, not two per id of the history', async () => {
  const list = await readPendingActions(SAFE);
  expect(list.map((action) => action.actionId)).toContain(3000);
  // 3,000 ids read one by one are 6,000 queries: twenty-five minutes at the
  // network's four a second. A board must see the newest actions long before.
  expect(reads()).toBeLessThanOrEqual(600);
});
