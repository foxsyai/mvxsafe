/**
 * WEB-07: after a wallet attempt fails, the Safe page shows the error and
 * stops. It never re-reads the chain. A transaction that the API accepted but
 * whose answer was lost (a timeout on the POST) looks exactly like a failure,
 * the pending list stays as it was, and the natural next step is to try again:
 * for sign, perform and discard the retry is harmless, for a proposal it puts a
 * second identical action in front of the board.
 *
 * Run: cd /home/sebastian/FOXSY/mvxsafe/app && npx jest src/__audit__/web/WEB-07.test.tsx
 */
import './fixSetImmediate';
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { proposeSendEgld, signAction } from 'multisig/actions';
import { readHistory, readOverview, readPendingActions, readUserRole } from 'multisig/reads';
import { Safe } from 'pages/Safe/Safe';

const BOARD = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const OTHER = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx';
const TREASURY = 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => true,
  useGetAccount: () => ({
    address: 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
    nonce: 1
  })
}));

jest.mock('multisig/actions', () => ({
  signAction: jest.fn(),
  unsignAction: jest.fn(),
  performAction: jest.fn(),
  discardAction: jest.fn(),
  proposeSendEgld: jest.fn(),
  proposeSendToken: jest.fn(),
  proposeAddBoardMember: jest.fn(),
  proposeAddProposer: jest.fn(),
  proposeRemoveUser: jest.fn(),
  proposeChangeQuorum: jest.fn()
}));

jest.mock('components/Address', () => ({
  AddressLine: ({ address }: { address: string }) => <span>{address}</span>
}));

jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readOverview: jest.fn(),
  readPendingActions: jest.fn(),
  readHistory: jest.fn(),
  readUserRole: jest.fn()
}));

// What a lost answer looks like: the POST went out, the reply never came.
const lostAnswer = () => Promise.reject(new Error('timeout of 6000ms exceeded'));

beforeEach(() => {
  window.localStorage.setItem(
    'mvxsafe.savedSafes',
    JSON.stringify([{ name: 'Treasury', address: TREASURY }])
  );
  (readOverview as jest.Mock).mockResolvedValue({
    address: TREASURY,
    egld: 1,
    egldPrice: 10,
    worthUsd: 10,
    tokens: [],
    nftCount: 0,
    quorum: 2,
    boardMembers: [BOARD, OTHER],
    proposerCount: 0,
    actionCount: 3,
    pendingCount: 1
  });
  (readPendingActions as jest.Mock).mockResolvedValue([
    { actionId: 3, description: 'Send 1,000 FOXSY to erd1alic...e', signerCount: 0, signers: [], formerSigners: [], quorumReached: false }
  ]);
  (readHistory as jest.Mock).mockResolvedValue([]);
  (readUserRole as jest.Mock).mockResolvedValue('BoardMember');
  (signAction as jest.Mock).mockReset();
  (signAction as jest.Mock).mockImplementation(lostAnswer);
  (proposeSendEgld as jest.Mock).mockReset();
  (proposeSendEgld as jest.Mock).mockImplementation(lostAnswer);
});

const Harness = () => (
  <MemoryRouter initialEntries={[`/safe/${TREASURY}`]}>
    <Routes>
      <Route path='/safe/:address' element={<Safe />} />
    </Routes>
  </MemoryRouter>
);

// How many times the pending list has been read so far.
const reads = () => (readPendingActions as jest.Mock).mock.calls.length;

test('after a signing attempt fails, the page reads the chain again within 20 seconds', async () => {
  render(<Harness />);
  await screen.findByText(/Send 1,000 FOXSY/);
  const before = reads();

  fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
  await screen.findByText(/did not go through|may still have gone through/);

  await waitFor(() => expect(reads()).toBeGreaterThan(before), { timeout: 20_000, interval: 500 });
}, 30_000);

test('after a proposal attempt fails, the page reads the chain again within 20 seconds', async () => {
  render(<Harness />);
  await screen.findByText(/Send 1,000 FOXSY/);
  const before = reads();

  fireEvent.click(screen.getByRole('button', { name: 'Send EGLD' }));
  fireEvent.change(screen.getByPlaceholderText('erd1...'), { target: { value: OTHER } });
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Propose' }));
  await screen.findByText(/did not go through|may still have gone through/);
  expect(proposeSendEgld).toHaveBeenCalledTimes(1);

  await waitFor(() => expect(reads()).toBeGreaterThan(before), { timeout: 20_000, interval: 500 });
}, 30_000);
