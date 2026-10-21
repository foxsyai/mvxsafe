// SC-01, found by the review of PR #11 (21 Oct 2026): when the bulk view
// fails, the page reads every action id one at a time, at four requests a
// second, and forget() drops them all after every transaction. A safe with a
// long history took minutes per load and held up the shared queue.
//
// Correct behaviour: an id carried out or discarded comes back as Nothing for
// good (ids are never reused), so it is read once and then remembered, while
// pending ids are read afresh. The ten newest are always read again: a node a
// few seconds behind answers Nothing for an action proposed moments ago.
jest.mock('multisig/network', () => {
  const { networkMock } = require('./SC-01.mock');
  const { Address } = require('@multiversx/sdk-core');
  const { bigBytes, encodeAction } = require('../../display/fixtures');
  const ALICE =
    'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
  const reads: number[] = ((globalThis as any).__historyReads = []);
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
      // Ids 1 to 28 were carried out or discarded, 29 is the large one, 30 waits.
      queryContract: async (query: {
        function: string;
        arguments?: Uint8Array[];
      }) => {
        const { function: fn, arguments: args = [] } = query;
        if (fn === 'getActionLastIndex') return parts(fn, [bigBytes(30n)]);
        if (fn === 'getPendingActionFullInfo')
          throw new Error('storage decode error: invalid value');
        if (fn === 'getActionData') {
          const id = idOf(args);
          reads.push(id);
          if (id === 29) throw new Error('storage decode error: invalid value');
          if (id === 30)
            return parts(fn, [
              encodeAction({
                kind: 'SendTransferExecute',
                to: ALICE,
                egld: 10n ** 15n
              })
            ]);
          return parts(fn, [new Uint8Array(0)]);
        }
        if (fn === 'getActionSigners')
          return parts(fn, [Address.newFromBech32(ALICE).getPublicKey()]);
        return networkMock.networkProvider.queryContract(query);
      }
    }
  };
});

import { readPendingActions } from 'multisig/reads';
import { SAFE } from './SC-01.mock';

const reads = () => (globalThis as any).__historyReads as number[];

test('control: the first read lists the large action and the pending one, reading every id', async () => {
  const list = await readPendingActions(SAFE);
  expect(list.map((action) => action.actionId)).toEqual([29, 30]);
  expect(reads()).toHaveLength(30);
});

test('the next read, after forget(), reads only the ten newest ids again', async () => {
  reads().length = 0;
  const list = await readPendingActions(SAFE);
  expect(list.map((action) => action.actionId)).toEqual([29, 30]);
  expect([...reads()].sort((a, b) => a - b)).toEqual([
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30
  ]);
});
