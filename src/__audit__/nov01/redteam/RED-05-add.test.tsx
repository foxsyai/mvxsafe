// RED-05 on the Add form: a name in use is refused while it can still be changed.
jest.mock('lib', () => ({
  useGetIsLoggedIn: () => false,
  useGetAccount: () => ({ address: '', nonce: 0 })
}));
jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readCard: jest.fn(() => new Promise(() => undefined)),
  readUserRole: jest.fn(() => new Promise(() => undefined))
}));

import '../../display/restoreSetImmediate';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { addSafe, getAllSafes } from 'multisig/savedSafes';
import { Safes } from 'pages/Safes/Safes';

const TREASURY =
  'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
const OTHER = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';

const add = (name: string) => {
  render(
    <MemoryRouter>
      <Safes />
    </MemoryRouter>
  );
  fireEvent.change(screen.getByPlaceholderText('Name'), {
    target: { value: name }
  });
  fireEvent.change(screen.getByPlaceholderText('erd1...'), {
    target: { value: OTHER }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  addSafe({ name: 'Treasury', address: TREASURY });
});

test('a name in use is refused, and nothing is added', () => {
  add('treasury');
  expect(screen.getByText(/already goes by that name/)).toBeTruthy();
  expect(getAllSafes()).toHaveLength(1);
});

test('control: a new name is added', () => {
  add('Grants');
  expect(screen.queryByText(/already goes by that name/)).toBeNull();
  expect(getAllSafes().map((safe) => safe.name)).toEqual([
    'Treasury',
    'Grants'
  ]);
});
