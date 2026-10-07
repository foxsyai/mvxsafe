// DISP-12: the role starts as 'None' and the page prints a sentence for it as
// soon as a wallet is connected. The balances, the board (with the "you" mark)
// and the pending actions arrive first; the role is the last read in load().
// Until it lands, a board member is told "You are not on this board, so you can
// only look", next to a board list that marks them as "you".
jest.mock('multisig/network', () => require('./fixtures').networkMock);
jest.mock('lib', () => require('./mocks').libMock);
jest.mock('multisig/actions', () => require('./mocks').actionsMock);

import './restoreSetImmediate';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Safe } from 'pages/Safe/Safe';
import { ALICE, BOB, CAROL, SAFE, useChain, useDelay } from './fixtures';
import { connectAs } from './mocks';

afterEach(() => useDelay([], 0));

const renderWithoutWaiting = () =>
  render(
    <MemoryRouter initialEntries={[`/safe/${SAFE}`]}>
      <Routes>
        <Route path='/safe/:address' element={<Safe />} />
      </Routes>
    </MemoryRouter>
  );

test('control: once the role is known, a board member is told so', async () => {
  connectAs(BOB);
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], roles: { [BOB]: 2 }, pending: [] });
  renderWithoutWaiting();
  await screen.findByText('Refresh', {}, { timeout: 8000 });
  expect(screen.getByText(/a board member here/)).toBeTruthy();
});

test('while the role is still being read, a board member must not be told they are not on the board', async () => {
  connectAs(BOB);
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], roles: { [BOB]: 2 }, pending: [] });
  useDelay(['userRole'], 1500);
  renderWithoutWaiting();
  // The board has arrived (bob is marked "you") but the role has not.
  await screen.findByText('you', {}, { timeout: 8000 });
  expect(screen.queryByText(/not on this board/)).toBeNull();
});
