// DISP-08, on the page: two tokens with the ticker FOXSY are two rows called FOXSY
// in the holdings and two identical choices in the token select of the propose
// form. Nothing on the page tells FOXSY-5d5f3e from FOXSY-bb84b1.
jest.mock('multisig/network', () => require('./fixtures').networkMock);
jest.mock('lib', () => require('./mocks').libMock);
jest.mock('multisig/actions', () => require('./mocks').actionsMock);

import './restoreSetImmediate';
import { screen } from '@testing-library/react';
import { ALICE, BOB, CAROL, SAFE, useChain, useTokens } from './fixtures';
import { connectAs, renderSafe } from './renderSafe';

beforeEach(() => {
  connectAs(BOB);
  useTokens({
    'FOXSY-5d5f3e': { decimals: 18, ticker: 'FOXSY', name: 'Foxsy', balance: '1000000000000000000000000' },
    'FOXSY-bb84b1': { decimals: 18, ticker: 'FOXSY', name: 'Foxsy', balance: '1000000000000000000000000' }
  });
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], roles: { [BOB]: 2 }, pending: [] });
});

test('control: both tokens are listed in the holdings', async () => {
  await renderSafe(SAFE);
  expect(screen.getAllByText('1,000,000').length).toBeGreaterThanOrEqual(2);
});

test('two different tokens must not be listed under the same bare name', async () => {
  await renderSafe(SAFE);
  expect(screen.getAllByText('FOXSY').length).toBeLessThan(2);
});

test('the token select of the propose form must not offer two identical choices', async () => {
  const { container } = await renderSafe(SAFE);
  const select = container.querySelector('select') as HTMLSelectElement;
  const options = [...select.querySelectorAll('option')].map((option) => option.textContent ?? '');
  expect(options).toHaveLength(2);
  // Two different tokens, one label: the proposer cannot tell which FOXSY they are sending.
  expect(new Set(options).size).toBe(options.length);
});
