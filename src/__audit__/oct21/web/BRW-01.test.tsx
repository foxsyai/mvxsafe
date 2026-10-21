/**
 * BRW-01: a role read that was started for one wallet and answers after
 * another wallet has connected is applied as the NEW wallet's role.
 *
 * Safe page (src/pages/Safe/Safe.tsx): `load` reads the overview, the pending
 * actions and then the role, and writes each with setState as it arrives. The
 * only guard is `alive` (unmounted or not); nothing says which load is the
 * latest. A wallet change starts a new load but does not cancel the old one, so
 * when the old one's readUserRole answers last (a retry after a 429, a slow
 * answer) it overwrites the role the new wallet was just read with. The page
 * then tells a stranger they are "a board member here" and shows Sign, Carry
 * it out and the propose form, or tells a board member they are "not on this
 * board" and hides everything, until a manual Refresh.
 *
 * List page (src/pages/Safes/Safes.tsx): `load` clears `roles` when the wallet
 * changes (WEB-02), but `readOne` of the older pass still runs setRoles when
 * its readUserRole answers, so the previous wallet's badge comes back for the
 * new wallet.
 *
 * Run, from the app folder: npx jest src/__audit__/oct21/web/BRW-01.test.tsx
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
import { ReactNode, useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  readCard,
  readContractInfo,
  readHistory,
  readOverview,
  readPendingActions,
  readUserRole
} from 'multisig/reads';
import { Safe } from 'pages/Safe/Safe';
import { Safes } from 'pages/Safes/Safes';

const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';
const ALICE = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const BOB = 'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4';

// The wallet hooks read a global, so a test can change the connected wallet
// and re-render, as sdk-dapp's store does on a disconnect and a new connect.
jest.mock('lib', () => ({
  useGetIsLoggedIn: () => Boolean((globalThis as any).__brw01Wallet),
  useGetAccount: () => ({
    address: (globalThis as any).__brw01Wallet ?? '',
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
  readCard: jest.fn(),
  readContractInfo: jest.fn()
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

// The page is built inside the harness on every render: a child element
// passed in from outside keeps its identity, and React would skip it.
let rerender: () => void = () => undefined;
const Harness = ({ page }: { page: () => ReactNode }) => {
  const [, tick] = useState(0);
  rerender = () => tick((count) => count + 1);
  return <>{page()}</>;
};
const connect = (wallet: string) => {
  (globalThis as any).__brw01Wallet = wallet;
  act(() => rerender());
};
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

const overview = {
  address: SAFE,
  egld: 1,
  egldRaw: '1000000000000000000',
  egldPrice: 4,
  worthUsd: 4,
  tokens: [],
  nftCount: 0,
  quorum: 2,
  boardMembers: [ALICE, BOB],
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
const card = {
  address: SAFE,
  tokens: [],
  egld: 1,
  quorum: 2,
  worthUsd: 0,
  boardSize: 2,
  pendingCount: 0,
  actionCount: 2,
  needsViewer: 0,
  readyCount: 0
};

beforeEach(() => {
  (globalThis as any).__brw01Wallet = ALICE;
  window.localStorage.clear();
  window.sessionStorage.clear();
  (readOverview as jest.Mock).mockReset().mockResolvedValue(overview);
  (readPendingActions as jest.Mock).mockReset().mockResolvedValue([action]);
  (readHistory as jest.Mock).mockReset().mockResolvedValue([]);
  (readContractInfo as jest.Mock)
    .mockReset()
    .mockResolvedValue({ ownerAddress: SAFE, codeHash: 'x', exists: true });
  (readCard as jest.Mock).mockReset().mockResolvedValue(card);
  (readUserRole as jest.Mock).mockReset();
});

const openSafe = () =>
  render(
    <Harness
      page={() => (
        <MemoryRouter initialEntries={[`/safe/${SAFE}`]}>
          <Routes>
            <Route path='/safe/:address' element={<Safe />} />
          </Routes>
        </MemoryRouter>
      )}
    />
  );

const openList = () => {
  window.localStorage.setItem(
    'mvxsafe.savedSafes',
    JSON.stringify([{ name: 'Watched', address: SAFE }])
  );
  return render(
    <Harness
      page={() => (
        <MemoryRouter>
          <Safes />
        </MemoryRouter>
      )}
    />
  );
};

describe('the safe page', () => {
  test('control: a stranger who connects after a board member is told so, and sees no buttons', async () => {
    (readUserRole as jest.Mock).mockImplementation(
      async (_safe: string, user: string) =>
        user === ALICE ? 'BoardMember' : 'None'
    );
    openSafe();
    await screen.findByText(/a board member here/);
    expect(screen.getByRole('button', { name: 'Sign' })).toBeInTheDocument();

    connect(BOB);
    await screen.findByText(/not on this board/);
    await settle();
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull();
  });

  test("a role read for the previous wallet that answers late does not become the new wallet's role", async () => {
    let aliceReads = 0;
    const slow = deferred<string>();
    (readUserRole as jest.Mock).mockImplementation(
      async (_safe: string, user: string) => {
        if (user !== ALICE) return 'None';
        aliceReads++;
        // The first read answers at once; the next one is slow (a 429 retried).
        return aliceReads === 1 ? 'BoardMember' : slow.promise;
      }
    );
    openSafe();
    await screen.findByText(/a board member here/);

    // Refresh starts a second read of the board member's role, still in flight.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    });
    await waitFor(() => expect(aliceReads).toBe(2));

    // The board member disconnects; a stranger connects on the same page.
    connect(BOB);
    await screen.findByText(/not on this board/);
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull();

    // Now the slow read for the previous wallet answers.
    slow.resolve('BoardMember');
    await settle();

    expect(screen.queryByText(/a board member here/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull();
    expect(screen.getByText(/not on this board/)).toBeInTheDocument();
  });
});

describe('the list', () => {
  test('control: a stranger who connects after a board member sees "read only"', async () => {
    (readUserRole as jest.Mock).mockImplementation(
      async (_safe: string, user: string) =>
        user === ALICE ? 'BoardMember' : 'None'
    );
    openList();
    await screen.findByText('board member');
    connect(BOB);
    await screen.findByText('read only');
    await settle();
    expect(screen.queryByText('board member')).toBeNull();
  });

  test('a role read for the previous wallet that answers late does not badge the safe for the new wallet', async () => {
    const slow = deferred<string>();
    (readUserRole as jest.Mock).mockImplementation(
      async (_safe: string, user: string) =>
        user === ALICE ? slow.promise : 'None'
    );
    openList();
    await waitFor(() => expect(readUserRole).toHaveBeenCalledWith(SAFE, ALICE));

    // The board member's role is still being read when a stranger connects.
    connect(BOB);
    await screen.findByText('read only');

    // The old read answers.
    slow.resolve('BoardMember');
    await settle();

    expect(screen.queryByText('board member')).toBeNull();
    expect(screen.getByText('read only')).toBeInTheDocument();
  });
});
