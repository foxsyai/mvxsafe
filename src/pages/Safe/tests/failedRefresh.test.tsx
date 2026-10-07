// Found in the mainnet test on 7 Oct 2026, while the public API was refusing
// requests: a refresh that failed after a good read replaced the safe with
// "unknown", "No board members found", and told a board member "You are not on
// this board". A failed read is not a fact about the safe.
import '../../../__audit__/web/fixSetImmediate';
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Safe } from 'pages/Safe/Safe';
import { readHistory, readOverview, readPendingActions, readUserRole } from 'multisig/reads';

const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';
const ME = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const COO = 'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => true,
  useGetAccount: () => ({ address: 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx', nonce: 1 })
}));
jest.mock('multisig/actions', () => ({
  signAction: jest.fn(), unsignAction: jest.fn(), performAction: jest.fn(), discardAction: jest.fn(),
  proposeSendEgld: jest.fn(), proposeSendToken: jest.fn(), proposeAddBoardMember: jest.fn(),
  proposeAddProposer: jest.fn(), proposeRemoveUser: jest.fn(), proposeChangeQuorum: jest.fn(),
  handOverSafe: jest.fn()
}));
jest.mock('components/Address', () => ({ AddressLine: ({ address }: { address: string }) => <span>{address}</span> }));
jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readOverview: jest.fn(), readPendingActions: jest.fn(), readHistory: jest.fn(), readUserRole: jest.fn(),
  readContractInfo: jest.fn(async () => ({ ownerAddress: SAFE, codeHash: 'x', exists: true }))
}));

const good = {
  address: SAFE, egld: 1, egldRaw: '1000000000000000000', egldPrice: 4, worthUsd: 4, tokens: [], nftCount: 0,
  quorum: 2, boardMembers: [ME, COO], proposers: [], proposerCount: 0, actionCount: 2, pendingCount: 1
};
const action = { actionId: 2, description: 'Send 0.1 EGLD to someone', signerCount: 1, signers: [COO], formerSigners: [], quorumReached: false };
const refused = () => Promise.reject(new Error('Request failed with status code 429'));

const open = () =>
  render(
    <MemoryRouter initialEntries={[`/safe/${SAFE}`]}>
      <Routes>
        <Route path='/safe/:address' element={<Safe />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  window.localStorage.setItem('mvxsafe.savedSafes', JSON.stringify([{ name: 'MVXSAFE', address: SAFE }]));
  (readOverview as jest.Mock).mockReset().mockResolvedValue(good);
  (readPendingActions as jest.Mock).mockReset().mockResolvedValue([action]);
  (readHistory as jest.Mock).mockReset().mockResolvedValue([]);
  (readUserRole as jest.Mock).mockReset().mockResolvedValue('BoardMember');
});

test('a role that could not be read is never reported as "not on this board"', async () => {
  (readUserRole as jest.Mock).mockImplementation(refused);
  open();
  await screen.findByText('Send 0.1 EGLD to someone');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  expect(screen.queryByText(/not on this board/)).toBeNull();
});

test('a refresh that fails keeps what was read, says so, and blocks signing until it is fresh', async () => {
  open();
  await screen.findByText('Send 0.1 EGLD to someone');
  expect(screen.getByRole('button', { name: 'Sign' })).not.toBeDisabled();

  (readOverview as jest.Mock).mockImplementation(refused);
  (readPendingActions as jest.Mock).mockImplementation(refused);
  (readUserRole as jest.Mock).mockImplementation(refused);
  await act(async () => { screen.getByRole('button', { name: 'Refresh' }).click(); });
  await waitFor(() => expect(readOverview).toHaveBeenCalledTimes(2));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });

  expect(screen.queryByText(/could not be read from the network/)).toBeNull();
  expect(screen.queryByText(/not on this board/)).toBeNull();
  expect(screen.getByText('2 of 2')).toBeInTheDocument();
  expect(screen.getByText('Send 0.1 EGLD to someone')).toBeInTheDocument();
  expect(screen.getByText(/did not answer/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign' })).toBeDisabled();
});

test('a page left stale by a refused read becomes fresh again by itself', async () => {
  open();
  await screen.findByText('Send 0.1 EGLD to someone');

  (readOverview as jest.Mock).mockImplementation(refused);
  (readPendingActions as jest.Mock).mockImplementation(refused);
  await act(async () => { screen.getByRole('button', { name: 'Refresh' }).click(); });
  await screen.findByText(/did not answer/);

  // The network answers again; nobody presses anything.
  (readOverview as jest.Mock).mockResolvedValue(good);
  (readPendingActions as jest.Mock).mockResolvedValue([{ ...action, signerCount: 0, signers: [] }]);
  await waitFor(() => expect(screen.queryByText(/did not answer/)).toBeNull(), { timeout: 9000, interval: 250 });
  expect(screen.getByRole('button', { name: 'Sign' })).not.toBeDisabled();
}, 15000);

test('a refused history alone does not block signing', async () => {
  (readHistory as jest.Mock).mockImplementation(refused);
  open();
  await screen.findByText('Send 0.1 EGLD to someone');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  expect(screen.queryByText(/did not answer/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign' })).not.toBeDisabled();
});

