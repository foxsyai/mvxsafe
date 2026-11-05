// Each card shows the action's number as a wallet writes it in the call's
// data, in hex: #10 is @0a. MetaMask's Snap shows only that data, so a signer
// matches the two (review of PR #24, 5 Nov 2026).
import '../../../__audit__/web/fixSetImmediate';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  readHistory,
  readOverview,
  readPendingActions,
  readUserRole
} from 'multisig/reads';
import { Safe } from 'pages/Safe/Safe';

const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';
const ME = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const BOB = 'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => true,
  useGetAccount: () => ({
    address: 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx',
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
  proposeChangeQuorum: jest.fn(),
  handOverSafe: jest.fn()
}));
jest.mock('components/Address', () => ({
  AddressLine: ({ address }: { address: string }) => <span>{address}</span>
}));
jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readOverview: jest.fn(),
  readPendingActions: jest.fn(),
  readHistory: jest.fn(),
  readUserRole: jest.fn(),
  readContractInfo: jest.fn(async () => ({
    ownerAddress: SAFE,
    codeHash: '9WWFKcUczCmF6LKXc3TJCUF+0H77krHer4ABN/XCWGE=',
    exists: true
  }))
}));

const good = {
  address: SAFE,
  egld: 1,
  egldRaw: '1000000000000000000',
  egldPrice: 4,
  worthUsd: 4,
  tokens: [],
  nftCount: 0,
  quorum: 2,
  boardMembers: [ME, BOB],
  proposers: [],
  proposerCount: 0,
  actionCount: 2,
  pendingCount: 1
};
const action = {
  actionId: 10,
  description: 'Send 0.1 EGLD to someone',
  signerCount: 1,
  signers: [BOB],
  formerSigners: [],
  quorumReached: false
};

const open = () =>
  render(
    <MemoryRouter initialEntries={[`/safe/${SAFE}`]}>
      <Routes>
        <Route path='/safe/:address' element={<Safe />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  window.localStorage.setItem(
    'mvxsafe.savedSafes',
    JSON.stringify([{ name: 'MVXSAFE', address: SAFE }])
  );
  (readOverview as jest.Mock).mockReset().mockResolvedValue(good);
  (readPendingActions as jest.Mock).mockReset().mockResolvedValue([action]);
  (readHistory as jest.Mock).mockReset().mockResolvedValue([]);
  (readUserRole as jest.Mock).mockReset().mockResolvedValue('BoardMember');
});

test('shows next to #10 the @0a a wallet shows, and next to #16 the @10', async () => {
  (readPendingActions as jest.Mock).mockResolvedValue([
    action,
    { ...action, actionId: 16, description: 'Send 0.2 EGLD to someone' }
  ]);
  open();
  expect(await screen.findByText('#10')).toBeInTheDocument();
  expect(screen.getByText('@0a')).toBeInTheDocument();
  expect(screen.getByText('#16')).toBeInTheDocument();
  expect(screen.getByText('@10')).toBeInTheDocument();
});
