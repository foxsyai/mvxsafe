/**
 * WEB-01: the Safe page keeps the previous safe's pending actions, overview and
 * role when the `:address` route parameter changes. Nothing resets the state,
 * nothing cancels the in-flight load, and the re-read timers armed after a
 * wallet action hold the previous safe's loader. The buttons on those stale
 * cards call signAction(signer, <new safe>, <old action id>).
 *
 * Run: cd /home/sebastian/FOXSY/mvxsafe/app && npx jest src/__audit__/web/WEB-01.test.tsx
 */
import './fixSetImmediate';
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { signAction } from 'multisig/actions';
import {
  PendingAction,
  readHistory,
  readOverview,
  readPendingActions,
  readUserRole
} from 'multisig/reads';
import { Safe } from 'pages/Safe/Safe';

const BOARD = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const OTHER = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx';
const TREASURY = 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p';
const TEAM = 'erd1qqqqqqqqqqqqqpgqt3kpgt5rfg9mrd3vpu6u6cxx758lkrgz0cqqcy9c32';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => true,
  useGetAccount: () => ({
    address: 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
    nonce: 1
  })
}));

jest.mock('multisig/actions', () => ({
  signAction: jest.fn(() => Promise.resolve('session')),
  unsignAction: jest.fn(() => Promise.resolve('session')),
  performAction: jest.fn(() => Promise.resolve('session')),
  discardAction: jest.fn(() => Promise.resolve('session')),
  proposeSendEgld: jest.fn(),
  proposeSendToken: jest.fn(),
  proposeAddBoardMember: jest.fn(),
  proposeAddProposer: jest.fn(),
  proposeRemoveUser: jest.fn(),
  proposeChangeQuorum: jest.fn()
}));

// The address line is not what is under test; a plain span keeps the herotag
// lookup off the network.
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const overviewOf = (address: string) => ({
  address,
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

// Both safes happen to have a pending action #3. They are different actions.
const treasuryAction: PendingAction = {
  actionId: 3,
  description: 'Send 1,000 FOXSY to erd1alic...e',
  signerCount: 0,
  signers: [],
      formerSigners: [],
  quorumReached: false
};
const teamAction: PendingAction = {
  actionId: 3,
  description: 'Add erd1attac...ker to the board',
  signerCount: 0,
  signers: [],
      formerSigners: [],
  quorumReached: false
};

let teamPending: ReturnType<typeof deferred<PendingAction[]>>;

beforeEach(() => {
  window.localStorage.setItem(
    'mvxsafe.savedSafes',
    JSON.stringify([
      { name: 'Treasury', address: TREASURY },
      { name: 'Team', address: TEAM }
    ])
  );
  teamPending = deferred<PendingAction[]>();
  (readOverview as jest.Mock).mockImplementation(async (address: string) => overviewOf(address));
  (readHistory as jest.Mock).mockResolvedValue([]);
  (readUserRole as jest.Mock).mockResolvedValue('BoardMember');
  (readPendingActions as jest.Mock).mockImplementation((address: string) =>
    address === TREASURY ? Promise.resolve([treasuryAction]) : teamPending.promise
  );
  (signAction as jest.Mock).mockClear();
});

// The app's own UI only reaches a safe from the list, so this link stands for
// any Safe -> Safe transition: browser back/forward between two safe URLs, or
// any future "next safe" link. The route element is the same, so React keeps
// the component instance and its state.
const Harness = () => (
  <MemoryRouter initialEntries={[`/safe/${TREASURY}`]}>
    <Link to={`/safe/${TEAM}`}>open Team</Link>
    <Routes>
      <Route path='/safe/:address' element={<Safe />} />
    </Routes>
  </MemoryRouter>
);

test("the previous safe's pending actions are not shown under the new safe's title", async () => {
  render(<Harness />);
  await screen.findByText(/Send 1,000 FOXSY/);

  fireEvent.click(screen.getByText('open Team'));
  await screen.findByRole('heading', { level: 1, name: 'Team' });

  // Team's list has not arrived yet. The page is titled Team and shows Team's
  // address; the pending cards must not be Treasury's.
  expect(screen.queryByText(/Send 1,000 FOXSY/)).toBeNull();
});

test('Sign on the Team page never sends an action id that the Team list did not show', async () => {
  render(<Harness />);
  await screen.findByText(/Send 1,000 FOXSY/);

  fireEvent.click(screen.getByText('open Team'));
  await screen.findByRole('heading', { level: 1, name: 'Team' });

  // Team's pending list never resolves in this test, so whatever Sign button is
  // on screen belongs to Treasury's card. Pressing it must not sign on Team.
  const sign = screen.queryByRole('button', { name: 'Sign' });
  if (sign) fireEvent.click(sign);
  expect(signAction).not.toHaveBeenCalledWith(expect.anything(), TEAM, expect.anything());
});

test('a re-read timer armed on Treasury does not replace the Team list seconds later', async () => {
  render(<Harness />);
  await screen.findByText(/Send 1,000 FOXSY/);

  // Sign on Treasury. run() then arms re-reads at 4 s, 10 s and 20 s that hold
  // Treasury's loader.
  fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
  await waitFor(() => expect(signAction).toHaveBeenCalledWith(expect.anything(), TREASURY, 3));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign' })).not.toBeDisabled());

  fireEvent.click(screen.getByText('open Team'));
  teamPending.resolve([teamAction]);
  await screen.findByText(/Add erd1attac/);
  expect(screen.queryByText(/Send 1,000 FOXSY/)).toBeNull();

  // Let the first Treasury timer fire.
  await new Promise((r) => setTimeout(r, 4600));

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Team');
  expect(screen.queryByText(/Send 1,000 FOXSY/)).toBeNull();
  expect(screen.getByText(/Add erd1attac/)).toBeInTheDocument();
}, 15000);
