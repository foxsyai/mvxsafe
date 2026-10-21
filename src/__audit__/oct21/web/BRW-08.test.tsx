/**
 * BRW-08: the stuck-wallet escape leaves the first prompt's promise running,
 * and when that promise finally settles, `run` calls setWorking(0)
 * unconditionally (src/pages/Safe/Safe.tsx). If the visitor has meanwhile
 * started another action, whose wallet prompt is open, every button is
 * re-enabled under it, and a third transaction can be built on the same nonce.
 * The 7 Oct report noted this beside WEB-08; the fix covered the first click
 * (`working !== 0` on every button) and not this path.
 *
 * Run, from the app folder: npx jest src/__audit__/oct21/web/BRW-08.test.tsx
 */
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
  actionCount: 4,
  pendingCount: 2
};
const pending = [3, 4].map((actionId) => ({
  actionId,
  description: `Send ${actionId},000 FOXSY to someone`,
  signerCount: 0,
  signers: [],
  formerSigners: [],
  quorumReached: false
}));

interface Prompt {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}
let prompts: Prompt[] = [];

let quiet: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  prompts = [];
  (readOverview as jest.Mock).mockReset().mockResolvedValue(overview);
  (readPendingActions as jest.Mock).mockReset().mockResolvedValue(pending);
  (readHistory as jest.Mock).mockReset().mockResolvedValue([]);
  (readUserRole as jest.Mock).mockReset().mockResolvedValue('BoardMember');
  (readContractInfo as jest.Mock)
    .mockReset()
    .mockResolvedValue({ ownerAddress: SAFE, codeHash: 'x', exists: true });
  // Every Sign opens a wallet prompt the test answers by hand.
  (signAction as jest.Mock).mockReset().mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        prompts.push({ resolve, reject });
      })
  );
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
  await screen.findByText(/Send 4,000 FOXSY/);
  return screen.getAllByRole('button', { name: 'Sign' });
};

const flush = () =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });

test('control: while one wallet prompt is open, a second Sign does nothing (WEB-08)', async () => {
  const [signThree, signFour] = await open();
  fireEvent.click(signThree);
  expect(signAction).toHaveBeenCalledTimes(1);
  expect(signFour).toBeDisabled();
  fireEvent.click(signFour);
  expect(signAction).toHaveBeenCalledTimes(1);
});

test('an abandoned prompt that settles late does not re-enable the buttons under an open one', async () => {
  const [signThree, signFour] = await open();

  // The wallet never answers for #3; after 25 s the page offers a way out.
  fireEvent.click(signThree);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(25_000);
  });
  fireEvent.click(screen.getByRole('button', { name: 'start over' }));
  expect(signFour).toBeEnabled();

  // The visitor signs #4 instead; that prompt is open now.
  fireEvent.click(signFour);
  expect(signAction).toHaveBeenCalledTimes(2);
  expect(signThree).toBeDisabled();

  // The abandoned prompt for #3 is finally answered: refused.
  await act(async () => {
    prompts[0].reject(new Error('User rejected the request'));
  });
  await flush();

  // #4's prompt is still open, so nothing else may start.
  for (const button of screen.getAllByRole('button', { name: 'Sign' })) {
    expect(button).toBeDisabled();
  }
  fireEvent.click(screen.getAllByRole('button', { name: 'Sign' })[0]);
  expect(signAction).toHaveBeenCalledTimes(2);
});
