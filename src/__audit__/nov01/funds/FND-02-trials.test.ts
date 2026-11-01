/**
 * @jest-environment node
 *
 * FND-02, the bulk path: the same rogue proposer needs no poison at all. Every
 * pending SendAsyncCall is tried as the safe before the list is shown
 * (inspectCall -> trialAsSafe -> estimateTransactionCost), one simulation per
 * action, queued at four requests a second, and readPendingActions resolves
 * only when every one has answered. 2,000 junk calls (about 0.2 EGLD in fees)
 * are 2,000 simulations, eight minutes at best, before the board sees anything;
 * the API's rate limit (429, then 2 s, 4 s, 8 s pauses) makes it longer, and a
 * call to a contract that burns its gas makes each simulation slow.
 *
 * Correct behaviour, asserted here: listing the pending actions does not run a
 * simulation per action before anything is shown. The trials belong to the
 * cards a signer is looking at (or to a bounded, newest-first batch), not to
 * the list itself.
 */
jest.mock('multisig/network', () => {
  const {
    contractsNetworkMock,
    mockTrial
  } = require('../../../multisig/tests/contractsMock');
  const { Address } = require('@multiversx/sdk-core');
  const { bigBytes, encodeActionFullInfo } = require('../../display/fixtures');
  const ALICE =
    'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
  const TARGET =
    'erd1qqqqqqqqqqqqqpgqntmhxqa29ar4juhlprjjxaq790ykcj3uaujq2l9dzg';
  const N = 2000;
  const counts: Record<string, number> = ((globalThis as any).__fnd02t = {});
  const count = (fn: string) => (counts[fn] = (counts[fn] ?? 0) + 1);
  const parts = (fn: string, returnDataParts: Uint8Array[]) => ({
    function: fn,
    returnCode: 'ok',
    returnMessage: '',
    returnDataParts
  });
  mockTrial.answer = async () => {
    count('trial');
    return { gasLimit: 3800000 };
  };
  return {
    ...contractsNetworkMock,
    networkProvider: {
      ...contractsNetworkMock.networkProvider,
      queryContract: async (query: {
        function: string;
        arguments?: Uint8Array[];
      }) => {
        const { function: fn } = query;
        count(fn);
        if (fn === 'getQuorum') return parts(fn, [bigBytes(2n)]);
        if (fn === 'getNumProposers') return parts(fn, [bigBytes(1n)]);
        if (fn === 'getAllProposers')
          return parts(fn, [Address.newFromBech32(TARGET).getPublicKey()]);
        if (fn === 'getAllBoardMembers')
          return parts(fn, [Address.newFromBech32(ALICE).getPublicKey()]);
        if (fn === 'getActionLastIndex')
          return parts(fn, [bigBytes(BigInt(N))]);
        if (fn === 'getPendingActionFullInfo')
          return parts(
            fn,
            Array.from({ length: N }, (_, at) =>
              encodeActionFullInfo({
                id: at + 1,
                action: {
                  kind: 'SendAsyncCall',
                  to: TARGET,
                  endpoint: 'claim',
                  args: []
                },
                signers: []
              })
            )
          );
        return contractsNetworkMock.networkProvider.queryContract(query);
      }
    }
  };
});

import { PENDING_PAGE, readPendingActions } from 'multisig/reads';
import { SAFE } from '../../display/fixtures';

const counts = () => (globalThis as any).__fnd02t as Record<string, number>;

test('control: the newest of the 2,000 pending calls are listed, each described, and the rest counted', async () => {
  const list = await readPendingActions(SAFE);
  // A page, by design (fix phase, 1 Nov 2026); the list says what it leaves out.
  expect(list).toHaveLength(PENDING_PAGE);
  expect(list[PENDING_PAGE - 1].actionId).toBe(2000);
  expect(list[0].description).toMatch(/claim/);
  expect(list.coverage?.pendingCount).toBe(2000);
  expect(list.coverage?.olderKnown).toBe(2000 - PENDING_PAGE);
});

test('listing the pending actions does not run one simulation per action first', async () => {
  delete counts().trial;
  await readPendingActions(SAFE);
  // Eight minutes of simulations at four a second before the board sees anything.
  expect(counts().trial ?? 0).toBeLessThanOrEqual(50);
});
