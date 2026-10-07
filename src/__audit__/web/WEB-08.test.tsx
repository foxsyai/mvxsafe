/**
 * WEB-08: while one action's wallet prompt is open, every other action's
 * buttons stay enabled (`disabled={working === action.actionId}` only covers
 * the one clicked). A second click starts a second transaction whose nonce is
 * read from the network before the first one is broadcast, so both carry the
 * same nonce and the second is refused by the node after the visitor signed it.
 *
 * Run, from the repository root: npx jest src/__audit__/web/WEB-08.test.tsx
 */
import './fixSetImmediate';
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { signAction } from 'multisig/actions';
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
    actionCount: 4,
    pendingCount: 2
  });
  (readPendingActions as jest.Mock).mockResolvedValue([
    { actionId: 3, description: 'Send 1,000 FOXSY to erd1alic...e', signerCount: 0, signers: [], formerSigners: [], quorumReached: false },
    { actionId: 4, description: 'Send 2,000 FOXSY to erd1bob...b', signerCount: 0, signers: [], formerSigners: [], quorumReached: false }
  ]);
  (readHistory as jest.Mock).mockResolvedValue([]);
  (readUserRole as jest.Mock).mockResolvedValue('BoardMember');
  (signAction as jest.Mock).mockReset();
  // The wallet prompt is open and the visitor has not answered yet.
  (signAction as jest.Mock).mockImplementation(() => new Promise(() => undefined));
});

const Harness = () => (
  <MemoryRouter initialEntries={[`/safe/${TREASURY}`]}>
    <Routes>
      <Route path='/safe/:address' element={<Safe />} />
    </Routes>
  </MemoryRouter>
);

test('while one wallet prompt is open, the page does not start a second transaction', async () => {
  render(<Harness />);
  await screen.findByText(/Send 2,000 FOXSY/);

  const [signThree, signFour] = screen.getAllByRole('button', { name: 'Sign' });
  fireEvent.click(signThree);
  expect(signAction).toHaveBeenCalledTimes(1);
  expect(signThree).toBeDisabled();

  fireEvent.click(signFour);
  expect(signAction).toHaveBeenCalledTimes(1);
});
