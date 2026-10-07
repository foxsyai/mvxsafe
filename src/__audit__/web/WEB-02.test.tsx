/**
 * WEB-02: the Safes list keeps the role badges ("board member", orange border)
 * of the previously connected wallet after a disconnect, and keeps them for a
 * new wallet when a safe cannot be re-read. The roles map is only cleared by
 * the Refresh button.
 *
 * Run, from the repository root: npx jest src/__audit__/web/WEB-02.test.tsx
 */
import './fixSetImmediate';
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readCard, readUserRole } from 'multisig/reads';
import { Safes } from 'pages/Safes/Safes';

const BOARD = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const STRANGER = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx';
const TREASURY = 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p';

const mockAuth = { loggedIn: true, address: BOARD };

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => mockAuth.loggedIn,
  useGetAccount: () => ({ address: mockAuth.address, nonce: 1 })
}));

jest.mock('components/Address', () => ({
  AddressLine: ({ address }: { address: string }) => <span>{address}</span>
}));

jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readCard: jest.fn(),
  readUserRole: jest.fn()
}));

const Harness = () => (
  <MemoryRouter>
    <Safes />
  </MemoryRouter>
);

beforeEach(() => {
  window.localStorage.setItem(
    'mvxsafe.savedSafes',
    JSON.stringify([{ name: 'Treasury', address: TREASURY }])
  );
  window.sessionStorage.clear();
  mockAuth.loggedIn = true;
  mockAuth.address = BOARD;
  (readCard as jest.Mock).mockReset();
  (readCard as jest.Mock).mockResolvedValue({
    address: TREASURY,
    tokens: [],
    egld: 0,
    quorum: 2,
    worthUsd: 0
  });
  (readUserRole as jest.Mock).mockReset();
  (readUserRole as jest.Mock).mockImplementation(async (_safe: string, user: string) =>
    user === BOARD ? 'BoardMember' : 'None'
  );
});

test('after disconnecting, no safe is still marked as yours', async () => {
  const view = render(<Harness />);
  await screen.findByText('board member');

  mockAuth.loggedIn = false;
  mockAuth.address = '';
  view.rerender(<Harness />);

  await waitFor(() => expect(screen.queryByText('board member')).toBeNull(), { timeout: 2000 });
  expect(screen.getByText('read only')).toBeInTheDocument();
});

test("a safe that cannot be re-read does not keep the previous wallet's role for the next wallet", async () => {
  const view = render(<Harness />);
  await screen.findByText('board member');

  // The next wallet is a stranger, and the safe's balance read fails (a 429
  // after four attempts, say). The role shown must not be the old wallet's.
  (readCard as jest.Mock).mockRejectedValue(new Error('/accounts answered 429'));
  mockAuth.address = STRANGER;
  view.rerender(<Harness />);

  await waitFor(() => expect(screen.queryByText('board member')).toBeNull(), { timeout: 2000 });
});
