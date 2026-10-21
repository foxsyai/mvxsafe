/**
 * BRW-05: the session cache of cards (sessionStorage 'mvxsafe.cards') is
 * checked one level deep. WEB-05 (7 Oct 2026) made the list keep only cards
 * with an array of tokens and a numeric EGLD balance, but what is inside is
 * trusted: a token entry that is null, or one without a numeric amount, throws
 * while the list renders (featuredToken's sort, then amount.toLocaleString),
 * and React unmounts the whole app. The counts are stripped from the cache and
 * a non-numeric quorum only prints oddly, so those are not in here. Same-origin
 * storage only (an extension, devtools, a future bug writing the key), so low,
 * like WEB-05.
 *
 * Run, from the app folder: npx jest src/__audit__/oct21/web/BRW-05.test.tsx
 */
import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Safes } from 'pages/Safes/Safes';

const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => false,
  useGetAccount: () => ({ address: '', nonce: 0 })
}));
jest.mock('components/Address', () => ({
  AddressLine: ({ address }: { address: string }) => <span>{address}</span>
}));
// The network never answers, so what the list shows is what the cache held.
jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readCard: jest.fn(() => new Promise(() => undefined)),
  readUserRole: jest.fn(() => new Promise(() => undefined))
}));

const wellFormed = {
  address: SAFE,
  tokens: [
    { identifier: 'WEGLD-a28c59', amount: 12.5, balance: '0', decimals: 18 }
  ],
  egld: 1,
  quorum: 2,
  worthUsd: 0,
  boardSize: 3
};

const open = (card: unknown) => {
  window.localStorage.setItem(
    'mvxsafe.savedSafes',
    JSON.stringify([{ name: 'Watched', address: SAFE }])
  );
  window.sessionStorage.setItem(
    'mvxsafe.cards',
    JSON.stringify({ [SAFE]: card })
  );
  return render(
    <MemoryRouter>
      <Safes />
    </MemoryRouter>
  );
};

let quiet: jest.SpyInstance;
beforeEach(() => {
  quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  quiet.mockRestore();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

test('control: a well-formed cached card renders at once', () => {
  open(wellFormed);
  expect(screen.getByText('2 of 3')).toBeInTheDocument();
  expect(screen.getByText('WEGLD-a28c59')).toBeInTheDocument();
});

test('a cached card whose token entries are null does not take the list down', () => {
  expect(() => open({ ...wellFormed, tokens: [null, null] })).not.toThrow();
  expect(screen.getByText('Watched')).toBeInTheDocument();
});

test('a cached token without a numeric amount does not take the list down', () => {
  expect(() =>
    open({ ...wellFormed, tokens: [{ identifier: 'X-000000', amount: null }] })
  ).not.toThrow();
  expect(screen.getByText('Watched')).toBeInTheDocument();
});
