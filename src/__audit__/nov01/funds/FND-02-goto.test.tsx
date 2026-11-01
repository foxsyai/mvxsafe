// Reaching any action directly (fix phase of the 1 Nov 2026 audit): with junk
// filed on top of it, an old action, or the poison a board has to discard, was
// about 150 presses of "Load more" away. One number reads that one action.
jest.mock('multisig/network', () => {
  const {
    networkMock,
    bigBytes,
    encodeAction
  } = require('../../display/fixtures');
  const { Address } = require('@multiversx/sdk-core');
  const scene: any = ((globalThis as any).__goto = { calls: {} });
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
        if (fn === 'getPendingActionFullInfo' && scene.bulkFails)
          throw new Error('storage decode error: invalid value');
        if (fn === 'getActionData') {
          const id = idOf(args);
          if (id === scene.poison)
            throw new Error('storage decode error: invalid value');
          const action = scene.actions(id);
          return parts(fn, [action ? encodeAction(action) : new Uint8Array(0)]);
        }
        if (fn === 'getActionSigners') {
          const signers: string[] = scene.signers(idOf(args));
          return parts(fn, [
            signers.length
              ? Buffer.concat(
                  signers.map((who) =>
                    Address.newFromBech32(who).getPublicKey()
                  )
                )
              : new Uint8Array(0)
          ]);
        }
        return networkMock.networkProvider.queryContract(query);
      }
    }
  };
});
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);
jest.mock('multisig/reads', () => {
  const actual = jest.requireActual('multisig/reads');
  return { ...actual, readCardChecks: jest.fn(actual.readCardChecks) };
});

import '../../display/restoreSetImmediate';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { readCardChecks } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';
import { connectAs, renderSafe } from '../../display/renderSafe';

const scene = () => (globalThis as any).__goto;
const realChecks = jest.requireActual('multisig/reads').readCardChecks;
const toAlice = { kind: 'SendTransferExecute', to: ALICE, egld: 10n ** 15n };

const goTo = async (text: string) => {
  fireEvent.change(screen.getByLabelText('Go to action number'), {
    target: { value: text }
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
  });
};
const button = (name: string) =>
  screen.getByRole('button', { name }) as HTMLButtonElement;
/** A button of the card asked for, not of the list below it. */
const asked = (name: string) =>
  within(
    screen.getByText('The action you asked for:').parentElement!
      .parentElement as HTMLElement
  ).getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  connectAs(BOB);
  const state = scene();
  state.calls = {};
  state.last = 50;
  state.poison = 50;
  state.bulkFails = true;
  state.actions = () => toAlice;
  state.signers = () => [];
  (readCardChecks as jest.Mock).mockReset().mockImplementation(realChecks);
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: []
  });
});

test('with the bulk view poisoned, an old action is read alone and shown as a normal card', async () => {
  await renderSafe(SAFE);
  expect(screen.queryByText('#3')).toBeNull();
  const before = { ...scene().calls };
  await goTo('3');
  await screen.findByText('#3');
  expect(scene().calls.getActionData - before.getActionData).toBe(1);
  expect(scene().calls.getActionSigners - before.getActionSigners).toBe(1);
  await waitFor(() => expect(asked('Sign').disabled).toBe(false));
  expect(asked('Discard').disabled).toBe(false);
});

test('Sign waits for the checks of the card asked for', async () => {
  await renderSafe(SAFE);
  let release: (value: any) => void = () => undefined;
  (readCardChecks as jest.Mock).mockImplementation(
    () => new Promise((resolve) => (release = resolve))
  );
  await goTo('3');
  await screen.findByText('#3');
  expect(asked('Sign').disabled).toBe(true);
  expect(asked('Discard').disabled).toBe(false);
  await act(async () => {
    release({ checks: [], perform: { simulate: true } });
  });
  await waitFor(() => expect(asked('Sign').disabled).toBe(false));
});

test('the poison, far below the page, can be reached and discarded', async () => {
  scene().last = 100;
  scene().poison = 5;
  await renderSafe(SAFE);
  await goTo('#5');
  await screen.findByText(/Action #5 cannot be read/);
  expect(() => asked('Sign')).toThrow();
  expect(asked('Discard').disabled).toBe(false);
});

test('an action carried out or discarded says so', async () => {
  scene().actions = (id: number) => (id === 7 ? null : toAlice);
  await renderSafe(SAFE);
  await goTo('7');
  await screen.findByText(/#7 was carried out or discarded/);
  expect(screen.queryByText('#7')).toBeNull();
});

test('a number above the last says it does not exist yet, and names the last', async () => {
  await renderSafe(SAFE);
  const before = scene().calls.getActionData;
  await goTo('51');
  await screen.findByText(/#51 does not exist yet.*#50/);
  expect(scene().calls.getActionData).toBe(before);
});

test.each(['abc', '0', '-3', '1.5', ''])(
  'what is not an action number (%s) reads nothing',
  async (text) => {
    await renderSafe(SAFE);
    const before = scene().calls.getActionData;
    await goTo(text);
    await screen.findByText(/An action number is a whole number/);
    expect(scene().calls.getActionData).toBe(before);
  }
);

test('it works with the bulk view answering too', async () => {
  scene().bulkFails = false;
  scene().last = 90;
  await renderSafe(SAFE);
  await goTo('3');
  await screen.findByText('#3');
});

test('a card already in the list is not shown twice', async () => {
  await renderSafe(SAFE);
  expect(screen.getAllByText('#49')).toHaveLength(1);
  await goTo('49');
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeNull()
  );
  expect(screen.getAllByText('#49')).toHaveLength(1);
});

test('a Refresh reads it again: an action gone meanwhile stops being offered', async () => {
  await renderSafe(SAFE);
  await goTo('3');
  await screen.findByText('#3');
  scene().actions = (id: number) => (id === 3 ? null : toAlice);
  await act(async () => {
    fireEvent.click(button('Refresh'));
  });
  await screen.findByText(/#3 was carried out or discarded/);
  expect(screen.queryByText('#3')).toBeNull();
});
