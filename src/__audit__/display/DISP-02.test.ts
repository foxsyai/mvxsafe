/**
 * @jest-environment node
 *
 * Node, not jsdom: the SDK hands decoded bytes back as node Buffers, and under
 * jest-environment-jsdom a Buffer is not instanceof the jsdom realm's Uint8Array,
 * which is a harness artefact a browser does not have (one realm).
 */
// DISP-02: MultiESDTNFTTransfer and ESDTNFTTransfer are how this build moves
// NFTs, SFTs, MetaESDT (LP, locked tokens) and any fungible token in one go.
// They are sent to the safe's OWN address with the real recipient, the tokens
// and the amounts in the arguments. The card says only
// "Call MultiESDTNFTTransfer on <the safe>": no recipient, no token, no amount.
jest.mock('multisig/network', () => require('./fixtures').networkMock);

import { Address } from '@multiversx/sdk-core';
import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, bigBytes, useChain, useRecorded } from './fixtures';

const pk = (bech32: string) => Address.newFromBech32(bech32).getPublicKey();

const describe1 = async (pendingAction: any) => {
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [{ id: 3, action: pendingAction, signers: [BOB] }] });
  const [action] = await readPendingActions(SAFE);
  return action.description;
};

test('control: a plain ESDTTransfer names recipient, token and amount', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: CAROL, endpoint: 'ESDTTransfer', args: ['WEGLD-a28c59', bigBytes(10n ** 17n)]
  });
  expect(text).toContain('erd1ydw9');
  expect(text).toContain('WEGLD');
  expect(text).toContain('0.1');
});

test('MultiESDTNFTTransfer to the safe itself must name the real recipient, the token and the amount', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: SAFE, endpoint: 'MultiESDTNFTTransfer',
    args: [pk(CAROL), bigBytes(1n), 'WEGLD-a28c59', bigBytes(0n), bigBytes(10n ** 17n)]
  });
  expect(text).toContain('erd1ydw9'); // carol, who receives the tokens
  expect(text).toContain('WEGLD');
  expect(text).toContain('0.1');
});

test('ESDTNFTTransfer to the safe itself must name the recipient, the token, its nonce and the amount', async () => {
  const text = await describe1({
    kind: 'SendAsyncCall', to: SAFE, endpoint: 'ESDTNFTTransfer',
    args: ['LKMEX-aab910', bigBytes(4321n), bigBytes(1000n * 10n ** 18n), pk(CAROL)]
  });
  expect(text).toContain('erd1ydw9');
  expect(text).toContain('LKMEX');
  expect(text).toMatch(/1,000/);
});

test('recorded devnet safe A, action #3: the MultiESDTNFTTransfer that, as action #4, moved 0.1 WEGLD to carol when carried out', async () => {
  const recorded = require('./recorded-devnet.json');
  useRecorded(recorded.safeA);
  const actions = await readPendingActions(recorded.safeA.address);
  useRecorded(null);
  const third = actions.find((a) => a.actionId === 3);
  expect(third).toBeDefined();
  expect(third!.description).toContain('erd1ydw9'); // carol receives the WEGLD
  expect(third!.description).toContain('WEGLD');
  expect(third!.description).toContain('0.1');
});
