// Signed actions first, when the bulk view works (fix phase of the 1 Nov 2026
// audit). A rogue proposer cannot sign, so flood junk carries no valid signature,
// and a real vote must not be buried under it. A signature from someone who has
// left the board does not count, here as anywhere.
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);

import '../../display/restoreSetImmediate';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { PENDING_PAGE, readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';
import { connectAs, renderSafe } from '../../display/renderSafe';

const toAlice = {
  kind: 'SendTransferExecute' as const,
  to: ALICE,
  egld: 10n ** 15n
};
const flood = (signed: Record<number, string[]>, count = 150) =>
  useChain({
    quorum: 2,
    board: [ALICE, BOB],
    roles: { [BOB]: 2 },
    pending: Array.from({ length: count }, (_, at) => ({
      id: at + 1,
      action: toAlice,
      signers: signed[at + 1] ?? []
    }))
  });
const shownIds = () =>
  screen
    .getAllByText(/^#\d+$/)
    .map((node) => Number(node.textContent!.slice(1)));

beforeEach(() => connectAs(BOB));

test('a signed action under a flood is on the first page, ahead of the junk', async () => {
  flood({ 3: [ALICE], 7: [ALICE, BOB] });
  const list = await readPendingActions(SAFE);
  expect(list).toHaveLength(PENDING_PAGE);
  expect(list.map((action) => action.actionId)).toEqual(
    expect.arrayContaining([3, 7, 150])
  );
  expect(list.coverage?.olderKnown).toBe(150 - PENDING_PAGE);
  expect(list.coverage?.signedNotShown).toBe(0);

  await renderSafe(SAFE);
  expect(shownIds().slice(0, 4)).toEqual([7, 3, 150, 149]);
});

test('the page says how it chose, and how many remain, none signed', async () => {
  flood({ 3: [ALICE] });
  await renderSafe(SAFE);
  const line = screen.getByText(/Showing 20 of 150 pending actions/);
  expect(line.textContent).toMatch(/with a signature first/);
  expect(line.textContent).toMatch(/other 130/);
  expect(line.textContent).toMatch(/none of them carries a signature/);
});

test('more signed than a page: the rest are counted, and Load more brings them before the junk', async () => {
  const signed: Record<number, string[]> = {};
  for (let id = 1; id <= 25; id++) signed[id] = [ALICE];
  flood(signed);
  const first = await readPendingActions(SAFE);
  expect(first.map((action) => action.actionId)).toEqual(
    Array.from({ length: 20 }, (_, at) => at + 6)
  );
  expect(first.coverage?.signedNotShown).toBe(5);

  await renderSafe(SAFE);
  expect(screen.getByText(/5 of them with a signature/)).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  });
  await waitFor(() => expect(shownIds()).toHaveLength(40));
  expect(shownIds().slice(0, 26)).toEqual([
    ...Array.from({ length: 25 }, (_, at) => 25 - at),
    150
  ]);
});

test('a signature from someone who left the board earns no place', async () => {
  flood({ 3: [CAROL] });
  const list = await readPendingActions(SAFE);
  expect(list.map((action) => action.actionId)).not.toContain(3);
});

test('control: no signatures anywhere is newest first', async () => {
  flood({});
  await renderSafe(SAFE);
  expect(shownIds().slice(0, 3)).toEqual([150, 149, 148]);
});

test('control: a Refresh keeps as many cards, in the same order', async () => {
  flood({ 3: [ALICE] });
  await renderSafe(SAFE);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  });
  await waitFor(() => expect(shownIds()).toHaveLength(40));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  });
  await screen.findByText('Refresh');
  expect(shownIds()).toHaveLength(40);
  expect(shownIds()[0]).toBe(3);
});
