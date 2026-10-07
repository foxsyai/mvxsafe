/**
 * @jest-environment node
 *
 * Node, not jsdom: the SDK hands decoded bytes back as node Buffers, and under
 * jest-environment-jsdom a Buffer is not instanceof the jsdom realm's Uint8Array,
 * which is a harness artefact a browser does not have (one realm).
 */
// DISP-01: a token transfer is always described with 18 decimals, whatever the
// token's real decimals. 1,000,000 USDC (6 decimals, raw 1e12) is shown as
// "Send 0 USDC", and the app's own propose form creates exactly such actions.
jest.mock('multisig/network', () => require('./fixtures').networkMock);

import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, bigBytes, useChain, useRecorded, useTokens } from './fixtures';

const describe1 = async (pendingAction: any) => {
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [{ id: 1, action: pendingAction, signers: [BOB] }] });
  const [action] = await readPendingActions(SAFE);
  return action.description;
};

beforeEach(() => {
  useTokens({
    'WEGLD-a28c59': { decimals: 18, ticker: 'WEGLD' },
    'USDC-c76f1f': { decimals: 6, ticker: 'USDC' },
    'TICKET-abcdef': { decimals: 0, ticker: 'TICKET' }
  });
});

test('control: an 18-decimal token transfer reads correctly', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: ALICE, endpoint: 'ESDTTransfer',
    args: ['WEGLD-a28c59', bigBytes(500000000000000000n)]
  });
  // Since the DISP-06/08 fixes the sentence carries the full identifier and address.
  expect(text).toMatch(/^Send 0\.5 WEGLD-a28c59 to erd1v6zz/);
});

test('1,000,000 USDC (6 decimals) must read as a million, not as zero', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: ALICE, endpoint: 'ESDTTransfer',
    args: ['USDC-c76f1f', bigBytes(1000000n * 10n ** 6n)]
  });
  expect(text).not.toMatch(/\b0 USDC\b/);
  expect(text).toMatch(/1,000,000(\.0+)? USDC/);
});

test('25,000 units of a 0-decimal token must not read as zero', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: ALICE, endpoint: 'ESDTTransfer',
    args: ['TICKET-abcdef', bigBytes(25000n)]
  });
  expect(text).not.toMatch(/\b0 TICKET\b/);
  expect(text).toMatch(/25,000 TICKET/);
});

test('recorded devnet safe A, action #1: 1,000,000 FOXSY-bb84b1 (6 decimals) proposed with the app\'s own builder', async () => {
  const recorded = require('./recorded-devnet.json');
  useRecorded(recorded.safeA);
  useTokens({ 'FOXSY-bb84b1': { decimals: 6, ticker: 'FOXSY', name: 'Foxsy' }, 'WEGLD-a28c59': { decimals: 18, ticker: 'WEGLD' } });
  const actions = await readPendingActions(recorded.safeA.address);
  useRecorded(null);
  const first = actions.find((a) => a.actionId === 1);
  expect(first).toBeDefined();
  expect(first!.description).not.toMatch(/\b0 FOXSY\b/);
  expect(first!.description).toMatch(/1,000,000(\.0+)? FOXSY/);
});
