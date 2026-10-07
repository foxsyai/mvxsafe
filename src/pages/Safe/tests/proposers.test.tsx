// Proposers are listed beside the board, each once, since the contract gives
// every address one role (asked for in the mainnet test, 7 Oct 2026).
import '../../../__audit__/web/fixSetImmediate';
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Safe } from 'pages/Safe/Safe';
import { readHistory, readOverview, readPendingActions, readUserRole } from 'multisig/reads';

const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';
const ME = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const BOB = 'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4';

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
  quorum: 2, boardMembers: [ME, BOB], proposers: [], proposerCount: 0, actionCount: 2, pendingCount: 1
};
const action = { actionId: 2, description: 'Send 0.1 EGLD to someone', signerCount: 1, signers: [BOB], formerSigners: [], quorumReached: false };
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

test('proposers are listed under the board, and a safe without any says so', async () => {
  const SPARE = 'erd1etc22n3wel7s452mkvfy2aw3zpef7lmdkkyv9xcryzssdcpahlnsvnzga0';
  (readOverview as jest.Mock).mockResolvedValue({ ...good, proposers: [SPARE], proposerCount: 1 });
  const view = open();
  await screen.findByText('Board and proposers');
  expect(await screen.findByText(SPARE)).toBeInTheDocument();
  expect(screen.getByText('1 proposer')).toBeInTheDocument();
  view.unmount();

  (readOverview as jest.Mock).mockResolvedValue({ ...good, proposers: [], proposerCount: 0 });
  open();
  expect(await screen.findByText('No proposers.')).toBeInTheDocument();
  expect(screen.getByText('0 proposers')).toBeInTheDocument();
});
