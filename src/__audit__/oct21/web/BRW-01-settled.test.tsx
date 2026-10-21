// BRW-01, found by the third review of PR #11 (21 Oct 2026): a load replaced
// by a newer one writes nothing, but still answered "fresh". The handler of the
// processed signal read that as "the new state is on the page" and released
// the buttons, while the page still showed the state from before the
// transaction: Sign was offered again on an action already signed.
//
// Correct behaviour: only the load whose answers are on the page releases them.
import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { signAction } from 'multisig/actions';
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
  actionId: 2,
  description: 'Send 0.1 EGLD to someone',
  signerCount: 0,
  signers: [],
  formerSigners: [],
  quorumReached: false
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

let quiet: jest.SpyInstance;
beforeEach(() => {
  quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  (readOverview as jest.Mock).mockReset().mockResolvedValue(overview);
  (readPendingActions as jest.Mock).mockReset().mockResolvedValue([action]);
  (readHistory as jest.Mock).mockReset().mockResolvedValue([]);
  (readUserRole as jest.Mock).mockReset().mockResolvedValue('BoardMember');
  (readContractInfo as jest.Mock)
    .mockReset()
    .mockResolvedValue({ ownerAddress: SAFE, codeHash: 'x', exists: true });
  (signAction as jest.Mock).mockReset().mockResolvedValue('session');
});
afterEach(() => quiet.mockRestore());

const settled = () =>
  window.dispatchEvent(
    new CustomEvent('mvxsafe:settled', { detail: { addresses: [SAFE] } })
  );
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

test('the processed signal twice in a row: the buttons wait for the read that is on the page', async () => {
  render(
    <MemoryRouter initialEntries={[`/safe/${SAFE}`]}>
      <Routes>
        <Route path='/safe/:address' element={<Safe />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText('Send 0.1 EGLD to someone');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
  });
  expect(await screen.findByText(/^Sent\./)).toBeInTheDocument();

  // The first re-read answers from before the signature landed; the second,
  // started a moment later, is still on its way.
  const late = deferred<unknown>();
  (readPendingActions as jest.Mock)
    .mockReset()
    .mockResolvedValueOnce([action])
    .mockImplementationOnce(() => late.promise);
  await act(async () => {
    settled();
    settled();
  });
  await flush();

  // The page still shows the action unsigned: it must not offer Sign again.
  expect(screen.getByRole('button', { name: 'Sign' })).toBeDisabled();

  // The newest read lands with the signature in it, and that releases the page.
  await act(async () => {
    late.resolve([{ ...action, signerCount: 1, signers: [ME] }]);
  });
  await flush();
  expect(
    screen.getByRole('button', { name: 'Remove my signature' })
  ).toBeEnabled();
});
