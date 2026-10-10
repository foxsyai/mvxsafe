// Seen on 10 Oct 2026: pressing Refresh again while the list was still
// reading showed "8 of 7", "9 of 7", "12 of 7". Each press started a new round
// of reads, the rounds already running carried on, and every finished read
// from any round counted toward the same number. The first round to finish
// also switched the button back to "Refresh" while the newest was still reading.
import '../../../__audit__/web/fixSetImmediate';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Address } from '@multiversx/sdk-core';
import { MemoryRouter } from 'react-router-dom';
import { readCard } from 'multisig/reads';
import { Safes } from 'pages/Safes/Safes';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => false,
  useGetAccount: () => ({ address: '', nonce: 0 })
}));
jest.mock('components/Address', () => ({ AddressLine: ({ address }: { address: string }) => <span>{address}</span> }));
jest.mock('multisig/reads', () => ({
  ...jest.requireActual('multisig/reads'),
  readCard: jest.fn(),
  readUserRole: jest.fn()
}));

// Seven valid contract addresses, made up for the test.
const SAFES = Array.from({ length: 7 }, (_, i) => {
  const bytes = Buffer.alloc(32, 0);
  bytes[31] = i + 1;
  return { name: `Safe ${i + 1}`, address: new Address(bytes).toBech32() };
});

// Every read waits until the test lets it finish, oldest first.
const waiting: Array<() => void> = [];

beforeEach(() => {
  window.localStorage.setItem('mvxsafe.savedSafes', JSON.stringify(SAFES));
  window.sessionStorage.clear();
  waiting.length = 0;
  (readCard as jest.Mock).mockReset().mockImplementation(
    (address: string) =>
      new Promise((resolve) =>
        waiting.push(() =>
          resolve({ address, tokens: [], egld: 1, quorum: 2, worthUsd: 0, boardSize: 3, pendingCount: 0, actionCount: 4, viewer: '', needsViewer: 0, readyCount: 0 })
        )
      )
  );
});

const refreshButton = () => screen.getByRole('button', { name: /Reading \d+ of \d+ safes|^Refresh$/ });
const label = () => refreshButton().getAttribute('aria-label') ?? refreshButton().textContent ?? '';
const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });

const release = async (count: number, seen: Array<[string, number]>) => {
  for (let i = 0; i < count && waiting.length > 0; i++) {
    await act(async () => waiting.shift()!());
    await settle();
    seen.push([label(), waiting.length]);
  }
};

test('pressing Refresh again while reading never counts past the number of safes', async () => {
  render(
    <MemoryRouter>
      <Safes />
    </MemoryRouter>
  );
  await settle();
  // [what the button says, reads still running] after every finished read.
  const seen: Array<[string, number]> = [];
  // The first round is under way when Refresh is pressed, pressed again a
  // little later, as one does when the list seems stuck, and once more when
  // the button says Refresh.
  await release(2, seen);
  fireEvent.click(refreshButton());
  await settle();
  await release(6, seen);
  fireEvent.click(refreshButton());
  await settle();
  // Once the button says Refresh again, it is pressed once more.
  while (waiting.length > 0 && label() !== 'Refresh') await release(1, seen);
  fireEvent.click(refreshButton());
  await settle();
  await release(Infinity, seen);

  for (const [text] of seen) {
    const count = text.match(/(\d+) of (\d+)/);
    if (count) expect(Number(count[1])).toBeLessThanOrEqual(Number(count[2]));
  }
  // The button says Refresh only once nothing is being read any more.
  for (const [text, running] of seen) if (text === 'Refresh') expect(running).toBe(0);
  expect(seen[seen.length - 1][0]).toBe('Refresh');
});
