// TXN-02 on the page (main session, 21 Oct 2026): when the safe was created but
// its handover was not sent, the Create page keeps it and opens it, where its
// owner is offered "hand it to itself". Before, it saved nothing and the safe
// was lost to the person who paid for it.
import '../../web/fixSetImmediate';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { createSafe } from 'multisig/actions';
import { getSavedSafes } from 'multisig/savedSafes';
import { Create } from 'pages/Create/Create';

const SAFE = 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => true,
  useGetAccount: () => ({
    address: 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3',
    nonce: 1
  })
}));
jest.mock('components/ConnectButton', () => ({ ConnectButton: () => null }));
jest.mock('multisig/actions', () => ({
  ...jest.requireActual('multisig/actions'),
  createSafe: jest.fn()
}));

const SafePage = () => <p>safe page {useParams().address}</p>;

const renderCreate = () =>
  render(
    <MemoryRouter initialEntries={['/create']}>
      <Routes>
        <Route path='/create' element={<Create />} />
        <Route path='/safe/:address' element={<SafePage />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => window.localStorage.clear());

test('control: a refused deploy saves nothing and stays on the page with the reason', async () => {
  (createSafe as jest.Mock).mockRejectedValue(new Error('Too many requests'));
  renderCreate();
  fireEvent.click(await screen.findByText('Create a 1 of 1 safe'));
  expect(await screen.findByText(/Too many requests/)).toBeInTheDocument();
  expect(getSavedSafes().map((safe) => safe.address)).not.toContain(SAFE);
});

test('a safe created without its handover is saved and opened', async () => {
  const { SafeNotHandedOver } = jest.requireActual('multisig/actions');
  (createSafe as jest.Mock).mockRejectedValue(
    new SafeNotHandedOver(SAFE, new Error('Too many requests'))
  );
  renderCreate();
  fireEvent.click(await screen.findByText('Create a 1 of 1 safe'));
  expect(await screen.findByText(`safe page ${SAFE}`)).toBeInTheDocument();
  expect(getSavedSafes().map((safe) => safe.address)).toContain(SAFE);
});
