/**
 * BRW-09: the propose form's "start over" releases the form but not the page.
 *
 * While a proposal waits for the wallet, ProposePanel (and CallForm,
 * UpgradeForm, DeploySource alike) tells the page through onBusyChange(true),
 * and the page sets `proposing`, which disables Sign, Remove my signature,
 * Carry it out and Discard on every pending card, and makes `run` return
 * silently. After 25 s the form offers "start over", whose handler is
 * `setBusy(false)` alone: onBusyChange(false) is never called, so `proposing`
 * stays true until the abandoned promise settles, which for a dismissed
 * xPortal request is never. The visitor can propose again, and nothing else,
 * until the page is reloaded.
 *
 * Run, from the app folder: npx jest src/__audit__/oct21/web/BRW-09.test.tsx
 */
import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { proposeSendEgld, signAction } from 'multisig/actions';
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
  pendingCount: 1
};
const action = {
  actionId: 2,
  description: 'Send 0.1 EGLD to someone',
  signerCount: 0,
  signers: [],
  formerSigners: [],
  quorumReached: false
};

let quiet: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  (readOverview as jest.Mock).mockReset().mockResolvedValue(overview);
  (readPendingActions as jest.Mock).mockReset().mockResolvedValue([action]);
  (readHistory as jest.Mock).mockReset().mockResolvedValue([]);
  (readUserRole as jest.Mock).mockReset().mockResolvedValue('BoardMember');
  (readContractInfo as jest.Mock)
    .mockReset()
    .mockResolvedValue({ ownerAddress: SAFE, codeHash: 'x', exists: true });
  // The wallet never answers the proposal: an xPortal request dismissed on
  // the phone.
  (proposeSendEgld as jest.Mock)
    .mockReset()
    .mockImplementation(() => new Promise(() => undefined));
  (signAction as jest.Mock).mockReset().mockResolvedValue('session');
});
afterEach(() => {
  quiet.mockRestore();
  jest.useRealTimers();
});

const open = async () => {
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
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Propose' }));
  });
  expect(proposeSendEgld).toHaveBeenCalledTimes(1);
};

test('control: while the proposal waits for the wallet, the pending card is disabled', async () => {
  await open();
  expect(screen.getByRole('button', { name: 'Sign' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Waiting for your wallet...' })
  ).toBeDisabled();
});

test('after "start over" in the propose form, the pending card is usable again', async () => {
  await open();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(25_000);
  });
  fireEvent.click(screen.getByRole('button', { name: 'start over' }));
  // The form itself is released...
  expect(screen.getByRole('button', { name: 'Propose' })).toBeEnabled();
  // ...and so must be the rest of the page.
  const sign = screen.getByRole('button', { name: 'Sign' });
  expect(sign).toBeEnabled();
  fireEvent.click(sign);
  expect(signAction).toHaveBeenCalledTimes(1);
});
