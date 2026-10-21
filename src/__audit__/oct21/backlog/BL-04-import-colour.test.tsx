// Backlog of the audit of 21 Oct 2026 (web report, cosmetic), proven by the
// main session: the list page said "Added 3." after a good import in the red
// it uses for errors, the same as "That file is not JSON."
//
// Correct behaviour: a result in the page's ordinary colour, an error in red.
import '../../web/fixSetImmediate';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Safes } from 'pages/Safes/Safes';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => false,
  useGetAccount: () => ({ address: '', nonce: 0 })
}));
jest.mock('components/Address', () => ({
  AddressLine: ({ address }: { address: string }) => <span>{address}</span>
}));
jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readCard: jest.fn(async () => {
    throw new Error('not read in this test');
  }),
  readUserRole: jest.fn(async () => 'None')
}));

const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';
const RED = 'text-[#F87171]';

const importFile = async (text: string) => {
  render(
    <MemoryRouter>
      <Safes />
    </MemoryRouter>
  );
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  const file = new File([text], 'safes.json');
  (file as any).text = async () => text;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test('control: a file that is not JSON is said in red', async () => {
  await importFile('not json');
  expect(screen.getByText('That file is not JSON.')).toHaveClass(RED);
});

test('a good import is said in the ordinary colour, not as an error', async () => {
  await importFile(
    JSON.stringify({ safes: [{ name: 'Treasury', address: SAFE }] })
  );
  expect(screen.getByText('Added 1.')).not.toHaveClass(RED);
});
