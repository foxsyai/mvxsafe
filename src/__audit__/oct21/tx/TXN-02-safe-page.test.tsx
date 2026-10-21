// TXN-02 on the safe page (review of PR #11, 21 Oct 2026): a safe opened after
// its handover was refused said "the network needs a few seconds to run the
// two transactions", although only one was sent, and the reason was gone.
//
// Correct behaviour: while it is being created, the page says the handover was
// not sent and that the safe can be handed to itself once it exists.
import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Safe } from 'pages/Safe/Safe';

const SAFE = 'erd1qqqqqqqqqqqqqpgqptkq6mj58k73dknuevzeg5u5pjwc9h9dxezsgxgyfs';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => true,
  useGetAccount: () => ({
    address: 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3',
    nonce: 1
  })
}));
jest.mock('multisig/actions', () => ({ handOverSafe: jest.fn() }));
jest.mock('components/Address', () => ({
  AddressLine: ({ address }: { address: string }) => <span>{address}</span>
}));
// Not on chain yet: every read of the safe is refused.
jest.mock('multisig/reads', () => {
  const missing = async () => {
    throw new Error('the safe does not exist yet');
  };
  return {
    ...jest.requireActual('multisig/reads'),
    readOverview: missing,
    readPendingActions: missing,
    readContractInfo: missing,
    readHistory: async () => [],
    readUserRole: async () => 'None'
  };
});

const open = (state: Record<string, unknown>) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: `/safe/${SAFE}`, state }]}>
      <Routes>
        <Route path='/safe/:address' element={<Safe />} />
      </Routes>
    </MemoryRouter>
  );

test('control: a safe just created says its two transactions are on their way', async () => {
  open({ creating: true });
  expect(
    await screen.findByText(/run the two\s+transactions/)
  ).toBeInTheDocument();
});

test('a safe whose handover was refused says so, and how to finish', async () => {
  open({ creating: true, handOverRefused: true });
  expect(await screen.findByText(/was not sent/)).toBeInTheDocument();
  expect(screen.getByText(/hand it to itself/)).toBeInTheDocument();
  expect(screen.queryByText(/two\s+transactions/)).toBeNull();
});
