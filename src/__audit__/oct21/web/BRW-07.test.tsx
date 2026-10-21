/**
 * BRW-07: after a proposal is sent, the form is usable again at once, with the
 * same inputs, and the page does not say it was sent.
 *
 * Sign, Remove my signature, Carry it out and Discard go through `run`
 * (src/pages/Safe/Safe.tsx), which after a successful send sets `awaiting`:
 * every button is disabled, the page says "Sent. The network takes a few
 * seconds to process it", and this holds until the processed signal or 30 s,
 * "so the same action is not sent twice meanwhile". A proposal goes through
 * ProposePanel's onProposed, which only re-reads the chain. The Propose button
 * is enabled again as soon as the wallet returns, the call and upgrade forms
 * keep every field as typed, the pending list does not show the new action
 * for another six to twelve seconds, and a second press files the same
 * proposal twice: two identical actions in front of the board, the path to
 * money leaving twice that WEB-07 (7 Oct 2026) was about.
 *
 * Run, from the app folder: npx jest src/__audit__/oct21/web/BRW-07.test.tsx
 */
import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { proposeSendEgld } from 'multisig/actions';
import {
  readContractInfo,
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
  readContractInfo: jest.fn()
}));

const overview = {
  address: SAFE,
  egld: 5,
  egldRaw: '5000000000000000000',
  egldPrice: 4,
  worthUsd: 20,
  tokens: [],
  nftCount: 0,
  quorum: 2,
  boardMembers: [ME, BOB],
  proposers: [],
  proposerCount: 0,
  actionCount: 2,
  pendingCount: 0
};

let quiet: jest.SpyInstance;
beforeEach(() => {
  quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  (readOverview as jest.Mock).mockReset().mockResolvedValue(overview);
  (readPendingActions as jest.Mock).mockReset().mockResolvedValue([]);
  (readHistory as jest.Mock).mockReset().mockResolvedValue([]);
  (readUserRole as jest.Mock).mockReset().mockResolvedValue('BoardMember');
  (readContractInfo as jest.Mock)
    .mockReset()
    .mockResolvedValue({ ownerAddress: SAFE, codeHash: 'x', exists: true });
  (proposeSendEgld as jest.Mock).mockReset();
});
afterEach(() => quiet.mockRestore());

const proposeButton = () =>
  screen.getByRole('button', { name: /^(Propose|Waiting)/ });

/** Opens the safe as a board member and files an EGLD proposal. */
const propose = async () => {
  render(
    <MemoryRouter initialEntries={[`/safe/${SAFE}`]}>
      <Routes>
        <Route path='/safe/:address' element={<Safe />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText(/a board member here/);
  fireEvent.click(screen.getByRole('button', { name: 'Send EGLD' }));
  fireEvent.change(screen.getByPlaceholderText('erd1...'), {
    target: { value: BOB }
  });
  fireEvent.change(screen.getByPlaceholderText('0.00'), {
    target: { value: '0.5' }
  });
  expect(proposeButton()).toBeEnabled();
  await act(async () => {
    fireEvent.click(proposeButton());
  });
  await waitFor(() => expect(proposeSendEgld).toHaveBeenCalledTimes(1));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};

test('control: a proposal the wallet refused leaves the form usable', async () => {
  (proposeSendEgld as jest.Mock).mockRejectedValue(
    new Error('User rejected the request')
  );
  await propose();
  expect(
    screen.getByText(/You refused it in your wallet, nothing was sent/)
  ).toBeInTheDocument();
  expect(proposeButton()).toBeEnabled();
});

test('a proposal that was sent waits for the network before the same form can be sent again', async () => {
  (proposeSendEgld as jest.Mock).mockResolvedValue('session');
  await propose();
  // The proposal is on its way and the pending list does not show it yet:
  // like a signature, it waits for the processed signal.
  expect(proposeButton()).toBeDisabled();
});
