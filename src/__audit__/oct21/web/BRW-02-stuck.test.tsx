// BRW-02, found by the review of PR #11 (21 Oct 2026): the fix put the
// handover under the one-prompt rule, so an open handover prompt disables
// every button on the page. But the way out of a wallet that never answers (an
// xPortal request dismissed on the phone), "start over" after 25 s, watched
// action prompts only: a stuck handover locked the page until a reload.
//
// Correct behaviour: a stuck handover offers "start over" like any prompt, and
// its late answer does not release a prompt opened after it.
import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { handOverSafe, signAction } from 'multisig/actions';
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

type Prompt = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};
const prompt = (): [Promise<unknown>, Prompt] => {
  let handle!: Prompt;
  const promise = new Promise((resolve, reject) => {
    handle = { resolve, reject };
  });
  return [promise, handle];
};

let quiet: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  (readOverview as jest.Mock).mockReset().mockResolvedValue(overview);
  (readPendingActions as jest.Mock).mockReset().mockResolvedValue([action]);
  (readHistory as jest.Mock).mockReset().mockResolvedValue([]);
  (readUserRole as jest.Mock).mockReset().mockResolvedValue('BoardMember');
  // The safe is still owned by the deployer, who is the connected wallet.
  (readContractInfo as jest.Mock)
    .mockReset()
    .mockResolvedValue({ ownerAddress: ME, codeHash: 'x', exists: true });
  (handOverSafe as jest.Mock).mockReset();
  (signAction as jest.Mock).mockReset();
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
  await screen.findByText('Send 0.1 EGLD to someone');
  return screen.findByRole('button', { name: 'Hand it to itself now' });
};
const wait = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
const sign = () => screen.getByRole('button', { name: 'Sign' });

test('control: a Sign whose wallet never answers offers "start over" after 25 s (WEB-08)', async () => {
  (signAction as jest.Mock).mockImplementation(() => prompt()[0]);
  await open();
  fireEvent.click(sign());
  await wait(25_000);
  expect(
    screen.getByRole('button', { name: 'start over' })
  ).toBeInTheDocument();
});

test('a handover whose wallet never answers offers "start over", which releases the page', async () => {
  (handOverSafe as jest.Mock).mockImplementation(() => prompt()[0]);
  const handOver = await open();
  fireEvent.click(handOver);
  expect(sign()).toBeDisabled();
  await wait(25_000);
  fireEvent.click(screen.getByRole('button', { name: 'start over' }));
  expect(sign()).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Hand it to itself now' })
  ).toBeEnabled();
});

test('the abandoned handover, answered late, does not release a Sign opened after it', async () => {
  const [late, handle] = prompt();
  (handOverSafe as jest.Mock).mockImplementation(() => late);
  (signAction as jest.Mock).mockImplementation(() => prompt()[0]);
  const handOver = await open();
  fireEvent.click(handOver);
  await wait(25_000);
  fireEvent.click(screen.getByRole('button', { name: 'start over' }));
  fireEvent.click(sign());
  expect(signAction).toHaveBeenCalledTimes(1);
  await act(async () => {
    handle.reject(new Error('User rejected the request'));
  });
  await wait(100);
  expect(sign()).toBeDisabled();
});
