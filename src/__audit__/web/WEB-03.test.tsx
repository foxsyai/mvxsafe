/**
 * WEB-03: labels are looked up with `labels[address]` on a plain object, and
 * the route parameter is not validated, so /safe/__proto__ makes getLabel return
 * Object.prototype, which React refuses as a child: the whole app unmounts to a
 * blank page. Any name that exists on Object.prototype misbehaves the same way.
 *
 * Run: cd /home/sebastian/FOXSY/mvxsafe/app && npx jest src/__audit__/web/WEB-03.test.tsx
 */
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getLabel } from 'multisig/addressBook';
import { Safe } from 'pages/Safe/Safe';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => false,
  useGetAccount: () => ({ address: '', nonce: 0 })
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
  proposeChangeQuorum: jest.fn()
}));

jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readOverview: jest.fn(() => Promise.reject(new Error('/accounts/__proto__ answered 400'))),
  readPendingActions: jest.fn(async () => []),
  readHistory: jest.fn(async () => []),
  readUserRole: jest.fn(async () => 'None')
}));

beforeEach(() => {
  window.localStorage.clear();
  (global as any).fetch = jest.fn(() => Promise.reject(new Error('offline in tests')));
});

test('a label lookup for a name that exists on Object.prototype is empty', () => {
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    expect(getLabel(key)).toBe('');
  }
});

test('the safe page survives /safe/__proto__ instead of unmounting the app', () => {
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(() =>
      render(
        <MemoryRouter initialEntries={['/safe/__proto__']}>
          <Routes>
            <Route path='/safe/:address' element={<Safe />} />
          </Routes>
        </MemoryRouter>
      )
    ).not.toThrow();
  } finally {
    quiet.mockRestore();
  }
});
