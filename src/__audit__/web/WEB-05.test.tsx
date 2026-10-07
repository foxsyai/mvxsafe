/**
 * WEB-05: the two localStorage readers trust the shape of what they parse.
 * savedSafes.read() returns any array as-is, addressBook.read() returns any
 * object as-is, and Safes.tsx parses sessionStorage['mvxsafe.cards'] as-is. A
 * stored list such as [null], a card without a tokens array, or a label that is
 * an object crashes the list page (TypeError in render) and makes addSafe throw,
 * which leaves the visitor with a blank page and no way to recover from inside
 * the app.
 *
 * Run, from the repository root: npx jest src/__audit__/web/WEB-05.test.tsx
 */
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getLabel } from 'multisig/addressBook';
import { readCard, readUserRole } from 'multisig/reads';
import { addSafe, getAllSafes } from 'multisig/savedSafes';
import { Safes } from 'pages/Safes/Safes';

const TREASURY = 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p';
const TEAM = 'erd1qqqqqqqqqqqqqpgqt3kpgt5rfg9mrd3vpu6u6cxx758lkrgz0cqqcy9c32';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => false,
  useGetAccount: () => ({ address: '', nonce: 0 })
}));

jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readCard: jest.fn(async (address: string) => ({ address, tokens: [], egld: 0, quorum: 2, worthUsd: 0 })),
  readUserRole: jest.fn(async () => 'None')
}));

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  (global as any).fetch = jest.fn(() => Promise.reject(new Error('offline in tests')));
});

test('entries that are not safes are dropped when the list is read', () => {
  window.localStorage.setItem(
    'mvxsafe.savedSafes',
    JSON.stringify([null, 42, TREASURY, { address: 7 }, { name: 'ok', address: TREASURY }])
  );
  expect(getAllSafes()).toEqual([{ name: 'ok', address: TREASURY }]);
});

test('adding a safe still works when the stored list holds junk', () => {
  window.localStorage.setItem('mvxsafe.savedSafes', '[null]');
  expect(() => addSafe({ name: 'Team', address: TEAM })).not.toThrow();
  expect(getAllSafes()).toContainEqual({ name: 'Team', address: TEAM });
});

test('the list page renders when the stored list holds junk', () => {
  window.localStorage.setItem('mvxsafe.savedSafes', '[null]');
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(() =>
      render(
        <MemoryRouter>
          <Safes />
        </MemoryRouter>
      )
    ).not.toThrow();
  } finally {
    quiet.mockRestore();
  }
});

test('the list page renders when the session cache of cards holds junk', () => {
  window.localStorage.setItem('mvxsafe.savedSafes', JSON.stringify([{ name: 'Treasury', address: TREASURY }]));
  window.sessionStorage.setItem('mvxsafe.cards', JSON.stringify({ [TREASURY]: { tokens: null } }));
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(() =>
      render(
        <MemoryRouter>
          <Safes />
        </MemoryRouter>
      )
    ).not.toThrow();
  } finally {
    quiet.mockRestore();
  }
});

test('a stored label that is not a string is ignored', () => {
  window.localStorage.setItem('mvxsafe.labels', JSON.stringify({ [TREASURY]: { nested: true } }));
  expect(getLabel(TREASURY)).toBe('');
});
