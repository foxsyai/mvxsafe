// TXB-03 on the create page: an unconfirmed deploy keeps its address in the list.
// And apiTimeout, which was set and never passed, reaches sdk-dapp.
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => {
  const actual = jest.requireActual('multisig/actions');
  return { ...actual, createSafe: jest.fn() };
});

import '../../display/restoreSetImmediate';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeNetwork } from '@multiversx/sdk-dapp/out/store/actions/network/initializeNetwork';
import { networkSelector } from '@multiversx/sdk-dapp/out/store/selectors/networkSelectors';
import { getState } from '@multiversx/sdk-dapp/out/store/store';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { apiTimeout } from 'config';
import { createSafe, SafeUnconfirmed } from 'multisig/actions';
import { getAllSafes } from 'multisig/savedSafes';
import { Create } from 'pages/Create/Create';
import { ALICE, BOB, SAFE } from '../../display/fixtures';
import { connectAs } from '../../display/mocks';

test('a deploy whose answer was lost keeps its address, and says what is known', async () => {
  window.localStorage.clear();
  connectAs(ALICE);
  (createSafe as jest.Mock).mockRejectedValue(new SafeUnconfirmed(SAFE));
  render(
    <MemoryRouter>
      <Create />
    </MemoryRouter>
  );
  const boxes = screen.getAllByPlaceholderText('erd1...');
  fireEvent.change(boxes[boxes.length - 1], { target: { value: BOB } });
  fireEvent.click(await screen.findByRole('button', { name: /Create/ }));
  await screen.findByText(/may still have gone through/);
  await waitFor(() =>
    expect(getAllSafes().map((safe) => safe.address)).toEqual([SAFE])
  );
});

test('the timeout set here is the one sdk-dapp uses', () => {
  // initConfig imports the stylesheets, so it is read rather than loaded here.
  expect(
    readFileSync(join(__dirname, '../../../initConfig.ts'), 'utf8')
  ).toMatch(/network: \{ apiTimeout: String\(apiTimeout\) \}/);
  initializeNetwork({
    customNetworkConfig: { apiTimeout: String(apiTimeout) },
    environment: 'devnet'
  } as any);
  expect(Number(networkSelector(getState()).apiTimeout)).toBe(apiTimeout);
  expect(apiTimeout).toBeGreaterThanOrEqual(15000);
});
