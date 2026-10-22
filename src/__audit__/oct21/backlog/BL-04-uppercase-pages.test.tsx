// Backlog of the audit of 21 Oct 2026, the upper-case address on the pages
// (main session): a safe's link written in capitals opens the same page as
// the lower-case one, and an address pasted in capitals into a propose form
// becomes the lower-case address every read and check then sees.
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);

import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ProposePanel } from 'components/Propose/ProposePanel';
import { Safe } from 'pages/Safe/Safe';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';
import { connectAs } from '../../display/renderSafe';

const Where = () => <p data-testid='where'>{useLocation().pathname}</p>;

test('a safe link in capitals opens the lower-case page', async () => {
  connectAs(BOB);
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: []
  });
  render(
    <MemoryRouter initialEntries={[`/safe/${SAFE.toUpperCase()}`]}>
      <Routes>
        <Route
          path='/safe/:address'
          element={
            <>
              <Safe />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  expect(
    await screen.findByText('Refresh', {}, { timeout: 8000 })
  ).toBeInTheDocument();
  expect(screen.getByTestId('where').textContent).toBe(`/safe/${SAFE}`);
});

test('an address pasted in capitals into the propose form becomes the lower-case address', () => {
  render(
    <ProposePanel
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      tokens={[]}
      boardSize={3}
      onProposed={jest.fn()}
    />
  );
  const to = screen.getByPlaceholderText('erd1...') as HTMLInputElement;
  fireEvent.change(to, { target: { value: CAROL.toUpperCase() } });
  expect(to.value).toBe(CAROL);
});
