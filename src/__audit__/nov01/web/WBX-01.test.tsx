/**
 * WBX-01: a safe whose quorum is 0 is shown on the LIST as "not a multisig".
 *
 * The contract accepts ChangeQuorum(0) (contract audit SC-02), and the 21 Oct
 * fix added a red banner on the SAFE PAGE for quorum 0. But the safe LIST
 * (src/pages/Safes/Safes.tsx) still conflates "quorum could not be read" (null,
 * a genuine non-multisig) with "quorum is 0" (a catastrophic multisig where any
 * single member moves everything alone), because both are falsy:
 *
 *     {card ? card.quorum ? (...) : 'not a multisig' : '...'}
 *
 * So a safe at quorum 0 is labelled "not a multisig" on the list, and its
 * pending/ready counts are hidden (the `{card?.quorum ? ...}` block), making a
 * drained-of-all-protection safe look like a plain address a signer can ignore.
 * The correct behaviour: distinguish quorum === null from quorum === 0.
 *
 * Run: npx jest src/__audit__/nov01/web/WBX-01.test.tsx
 */
import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readCard, readUserRole, SafeCard } from 'multisig/reads';
import { Safes } from 'pages/Safes/Safes';

const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => false,
  useGetAccount: () => ({ address: '', nonce: 0 })
}));
jest.mock('components/Address', () => ({
  AddressLine: ({ address }: { address: string }) => <span>{address}</span>
}));
jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readCard: jest.fn(),
  readUserRole: jest.fn()
}));

const cardWith = (quorum: number | null): SafeCard => ({
  address: SAFE,
  tokens: [],
  egld: 1.23,
  quorum,
  worthUsd: 0,
  boardSize: quorum === null ? null : 3,
  // Counts that are not 0, so "0" below can only be the quorum.
  pendingCount: 2,
  actionCount: 5,
  viewer: '',
  needsViewer: 0,
  readyCount: 2
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem(
    'mvxsafe.savedSafes',
    JSON.stringify([{ name: 'Treasury', address: SAFE }])
  );
  (readUserRole as jest.Mock).mockReset().mockResolvedValue('None');
  (readCard as jest.Mock).mockReset();
});

const open = () =>
  render(
    <MemoryRouter>
      <Safes />
    </MemoryRouter>
  );

test('a safe at quorum 0 is NOT shown as "not a multisig" on the list', async () => {
  (readCard as jest.Mock).mockResolvedValue(cardWith(0));
  open();
  // Wait until the card has loaded (its EGLD appears).
  await screen.findByText('1.23');
  // A quorum-0 safe is a multisig with no protection, not a non-multisig.
  expect(screen.queryByText('not a multisig')).toBeNull();
  // The dangerous quorum should be shown as the number 0.
  expect(screen.getByText('0')).toBeInTheDocument();
  expect(screen.getByText('0').className).toMatch(/F87171/);
  // And what is waiting stays in view.
  expect(screen.getByText('2 ready to carry out')).toBeInTheDocument();
  expect(screen.getByText('5')).toBeInTheDocument();
});

test('control: an address that is not a multisig (quorum null) IS shown as "not a multisig"', async () => {
  (readCard as jest.Mock).mockResolvedValue(cardWith(null));
  open();
  await screen.findByText('1.23');
  expect(screen.getByText('not a multisig')).toBeInTheDocument();
});
