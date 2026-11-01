/**
 * @jest-environment node
 *
 * The flood fix in the reads (fix phase of the 1 Nov 2026 audit): how far a read
 * of the pending actions goes, and what it says it left out.
 */
jest.mock('multisig/network', () => {
  const {
    networkMock,
    bigBytes,
    encodeAction
  } = require('../../display/fixtures');
  const { Address } = require('@multiversx/sdk-core');
  const scene: any = ((globalThis as any).__flood = { calls: {} });
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
        scene.calls[fn] = (scene.calls[fn] ?? 0) + 1;
        if (fn === 'getActionLastIndex')
          return parts(fn, [bigBytes(BigInt(scene.last))]);
        if (fn === 'getPendingActionFullInfo' && scene.poison)
          throw new Error('storage decode error: invalid value');
        if (fn === 'getActionData') {
          const id = idOf(args);
          if (scene.failFrom !== undefined && id <= scene.failFrom)
            throw new Error('getActionData answered 503');
          if (id === scene.poison)
            throw new Error('storage decode error: invalid value');
          const action = scene.actions(id);
          return parts(fn, [action ? encodeAction(action) : new Uint8Array(0)]);
        }
        if (fn === 'getActionSigners')
          return parts(fn, [
            scene.signers?.(id(args))?.length
              ? Buffer.concat(
                  scene
                    .signers(id(args))
                    .map((who: string) =>
                      Address.newFromBech32(who).getPublicKey()
                    )
                )
              : new Uint8Array(0)
          ]);
        return networkMock.networkProvider.queryContract(query);
        function id(a: Uint8Array[]) {
          return idOf(a);
        }
      }
    }
  };
});

import { PENDING_PAGE, readOverview, readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';

const scene = () => (globalThis as any).__flood;
const reads = () =>
  (scene().calls.getActionData ?? 0) + (scene().calls.getActionSigners ?? 0);
const toAlice = { kind: 'SendTransferExecute', to: ALICE, egld: 10n ** 15n };

beforeEach(() => {
  const state = scene();
  state.calls = {};
  state.last = 0;
  state.poison = 0;
  state.failFrom = undefined;
  state.signers = undefined;
  state.actions = () => toAlice;
  useChain({ quorum: 2, board: [ALICE, BOB], pending: [] });
});

test('a poison above 3,000 pending: a page of the newest, the rest stated as not read', async () => {
  scene().last = 3000;
  scene().poison = 2995;
  const list = await readPendingActions(SAFE);
  expect(list).toHaveLength(PENDING_PAGE);
  expect(list[PENDING_PAGE - 1].actionId).toBe(3000);
  expect(list.find((action) => action.actionId === 2995)?.unreadable).toBe(
    true
  );
  expect(reads()).toBeLessThanOrEqual(2 * PENDING_PAGE);
  expect(list.coverage).toMatchObject({
    pendingCount: null,
    oneByOne: true,
    olderUnread: 3000 - PENDING_PAGE,
    nextBefore: 3001 - PENDING_PAGE
  });
});

test('older actions join the page, and the read stops at the bottom with the count known', async () => {
  scene().last = 25;
  scene().poison = 25;
  const first = await readPendingActions(SAFE);
  expect(first.coverage?.olderUnread).toBe(5);
  const all = await readPendingActions(SAFE, {
    before: first.coverage!.nextBefore,
    known: first
  });
  expect(all.map((action) => action.actionId)).toEqual(
    Array.from({ length: 25 }, (_, at) => at + 1)
  );
  expect(all.coverage).toMatchObject({ olderUnread: 0, pendingCount: 25 });
});

test('a long history of finished actions: one pass stops at its limit, and says nothing is known below', async () => {
  scene().last = 3000;
  scene().poison = 3000;
  scene().actions = () => null;
  const list = await readPendingActions(SAFE);
  expect(list.map((action) => action.actionId)).toEqual([3000]);
  expect(scene().calls.getActionData).toBe(300);
  expect(list.coverage).toMatchObject({
    pendingCount: null,
    olderUnread: 2700,
    nextBefore: 2701
  });
});

test('the cards come as they are read', async () => {
  scene().last = 5;
  scene().poison = 5;
  const seen: number[] = [];
  await readPendingActions(SAFE, {
    onProgress: (list) => seen.push(list.length)
  });
  expect(seen).toEqual([1, 2, 3, 4, 5]);
});

test('the network fails part way: what was read stays, and the list says it stopped', async () => {
  scene().last = 40;
  scene().poison = 40;
  scene().failFrom = 35;
  const list = await readPendingActions(SAFE);
  expect(list.map((action) => action.actionId)).toEqual([36, 37, 38, 39, 40]);
  expect(list.coverage).toMatchObject({
    interrupted: true,
    pendingCount: null,
    olderUnread: 35,
    nextBefore: 36
  });
});

test('guard: the network fails on the first number: a failed read, never an empty list', async () => {
  // Above the numbers an earlier test remembered as finished.
  scene().last = 4000;
  scene().poison = 4001;
  scene().failFrom = 4000;
  await expect(readPendingActions(SAFE)).rejects.toThrow();
});

test('the overview counts from the view, and does not say a number it does not know', async () => {
  scene().last = 3000;
  scene().poison = 2;
  expect((await readOverview(SAFE)).pendingCount).toBeNull();
  expect(reads()).toBe(0);
});

test('a re-added member: a signature on an action not on the page still counts, when the view answers', async () => {
  // Carol's own signature no longer counts, so #1 earns no place on the page.
  useChain({
    quorum: 1,
    board: [ALICE, BOB],
    pending: [
      { id: 1, action: toAlice as any, signers: [CAROL] },
      ...Array.from({ length: 30 }, (_, at) => ({
        id: at + 2,
        action: toAlice as any,
        signers: []
      })),
      {
        id: 40,
        action: { kind: 'AddBoardMember' as const, address: CAROL },
        signers: []
      }
    ]
  });
  const list = await readPendingActions(SAFE);
  expect(list.map((action) => action.actionId)).not.toContain(1);
  const readd = list.find((action) => action.actionId === 40)!;
  const line = readd.checks!.find((check) => check.text.includes('#1'));
  expect(line?.tone).toBe('bad');
});

test('a re-added member, one by one: the card says what it could not look through, until it could', async () => {
  scene().last = 25;
  scene().poison = 24;
  scene().signers = (id: number) => (id === 2 ? [ALICE, CAROL] : []);
  scene().actions = (id: number) =>
    id === 25 ? { kind: 'AddBoardMember', address: CAROL } : toAlice;
  const first = await readPendingActions(SAFE);
  const card = () => first.find((action) => action.actionId === 25)!;
  expect(card().checks).toHaveLength(1);
  expect(card().checks![0].tone).toBe('warn');
  expect(card().checks![0].text).toMatch(/5 older action numbers/);

  const all = await readPendingActions(SAFE, {
    before: first.coverage!.nextBefore,
    known: first
  });
  const checks = all.find((action) => action.actionId === 25)!.checks!;
  expect(checks).toHaveLength(1);
  expect(checks[0].tone).toBe('bad');
  expect(checks[0].text).toMatch(/#2/);
});
