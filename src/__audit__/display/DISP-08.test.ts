/**
 * @jest-environment node
 *
 * Node, not jsdom: the SDK hands decoded bytes back as node Buffers, and under
 * jest-environment-jsdom a Buffer is not instanceof the jsdom realm's Uint8Array,
 * which is a harness artefact a browser does not have (one realm).
 */
// DISP-08: only the ticker of a token is shown (identifier.split('-')[0]).
// Anyone can issue a token with the ticker FOXSY; it gets a different random
// suffix, and that suffix is the only thing that tells the real FOXSY-5d5f3e
// from the copy. Two transfers of two different tokens read identically.
jest.mock('multisig/network', () => require('./fixtures').networkMock);

import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, bigBytes, useChain, useTokens } from './fixtures';

const describe1 = async (token: string) => {
  useChain({
    quorum: 2, board: [ALICE, BOB, CAROL],
    pending: [{ id: 7, action: { kind: 'SendAsyncCall', to: ALICE, endpoint: 'ESDTTransfer', args: [token, bigBytes(1000000n * 10n ** 18n)] }, signers: [BOB] }]
  });
  const [action] = await readPendingActions(SAFE);
  return action.description;
};

beforeEach(() => {
  useTokens({ 'FOXSY-5d5f3e': { decimals: 18, ticker: 'FOXSY', name: 'Foxsy' }, 'FOXSY-bb84b1': { decimals: 18, ticker: 'FOXSY', name: 'Foxsy' } });
});

test('control: the real FOXSY transfer reads as a FOXSY transfer', async () => {
  expect(await describe1('FOXSY-5d5f3e')).toMatch(/Send 1,000,000 FOXSY/);
});

test('a look-alike token must not be described identically to the real one', async () => {
  const real = await describe1('FOXSY-5d5f3e');
  const copy = await describe1('FOXSY-bb84b1');
  expect(copy).not.toBe(real);
});

test('the description carries the full identifier, which is the only thing that is unique', async () => {
  expect(await describe1('FOXSY-5d5f3e')).toContain('FOXSY-5d5f3e');
});
