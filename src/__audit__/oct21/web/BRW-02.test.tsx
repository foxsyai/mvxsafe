/**
 * BRW-02: "Hand it to itself now" skips the two rules every other wallet
 * action on the safe page follows (src/pages/Safe/Safe.tsx, handOver):
 *
 * 1. it calls awaitNetwork() whether or not anything was sent, so after the
 *    wallet refuses the handover the page says "Sent. The network takes a few
 *    seconds to process it" right under "You refused it in your wallet,
 *    nothing was sent", and locks Sign, Carry it out, Discard and Propose for
 *    thirty seconds (`run` only waits when `sent` is true);
 * 2. it sets `handingOver`, not `working`, so while the handover's wallet
 *    prompt is open every pending-card button is still enabled and a second
 *    transaction can be built on the same nonce (the WEB-08 rule, "one wallet
 *    prompt at a time", does not cover it).
 *
 * The owner of a safe that was deployed but never handed over, who also sits
 * on its board, sees both buttons at once.
 *
 * Run, from the app folder: npx jest src/__audit__/oct21/web/BRW-02.test.tsx
 */
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

let quiet: jest.SpyInstance;
beforeEach(() => {
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
afterEach(() => quiet.mockRestore());

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

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

test('control: a handover the wallet signed is reported as sent', async () => {
  (handOverSafe as jest.Mock).mockResolvedValue('session');
  const handOver = await open();
  await act(async () => {
    fireEvent.click(handOver);
  });
  await settle();
  expect(screen.getByText(/^Sent\./)).toBeInTheDocument();
});

test('a handover the wallet refused is not reported as sent, and does not lock the page', async () => {
  (handOverSafe as jest.Mock).mockRejectedValue(
    new Error('User rejected the request')
  );
  const handOver = await open();
  await act(async () => {
    fireEvent.click(handOver);
  });
  await settle();
  expect(
    screen.getByText(/You refused it in your wallet, nothing was sent/)
  ).toBeInTheDocument();
  expect(screen.queryByText(/^Sent\./)).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign' })).toBeEnabled();
});

test('while the handover waits for the wallet, no other transaction can start', async () => {
  (handOverSafe as jest.Mock).mockImplementation(
    () => new Promise(() => undefined)
  );
  const handOver = await open();
  fireEvent.click(handOver);
  expect(handOverSafe).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
  expect(signAction).not.toHaveBeenCalled();
});
