// Found in the mainnet test on 7 Oct 2026: going back to the list while the
// API was slow, two cards stayed on "..." for good. Their reads had been
// refused and the list never asked again.
import '../../../__audit__/web/fixSetImmediate';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readCard, readUserRole } from 'multisig/reads';
import { Safes } from 'pages/Safes/Safes';

const ME = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => true,
  useGetAccount: () => ({ address: 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx', nonce: 1 })
}));
jest.mock('components/Address', () => ({ AddressLine: ({ address }: { address: string }) => <span>{address}</span> }));
jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readCard: jest.fn(),
  readUserRole: jest.fn()
}));

const card = {
  address: SAFE, tokens: [], egld: 1, quorum: 2, worthUsd: 0,
  boardSize: 3, pendingCount: 0, actionCount: 9, viewer: ME, needsViewer: 0, readyCount: 0
};

beforeEach(() => {
  window.localStorage.setItem('mvxsafe.savedSafes', JSON.stringify([{ name: 'MVXSAFE', address: SAFE }]));
  window.sessionStorage.clear();
  (readUserRole as jest.Mock).mockReset().mockResolvedValue('BoardMember');
  (readCard as jest.Mock)
    .mockReset()
    .mockImplementationOnce(() => Promise.reject(new Error('timeout of 15000ms exceeded')))
    .mockResolvedValue(card);
});

test('a card whose read was refused says so and fills in by itself', async () => {
  render(
    <MemoryRouter>
      <Safes />
    </MemoryRouter>
  );
  expect(await screen.findByText(/trying again/)).toBeInTheDocument();
  // Nobody presses Refresh.
  expect(await screen.findByText('9', {}, { timeout: 9000 })).toBeInTheDocument();
  expect(screen.getByText('2 of 3')).toBeInTheDocument();
  expect(screen.queryByText(/trying again/)).toBeNull();
}, 15000);
