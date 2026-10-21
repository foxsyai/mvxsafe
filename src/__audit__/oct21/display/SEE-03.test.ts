// SEE-03 (from the display auditor's "suspected" list, proven by the main
// session, 21 Oct 2026): a built-in named AFTER a token transfer runs on the
// receiver with the safe as the caller. "ESDTTransfer(token, amount,
// ChangeOwnerAddress, <someone>)" sent to a contract the safe owns hands that
// contract away, yet only the top-level function was checked, so the card
// said it in words with no red line.
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);

import { Address } from '@multiversx/sdk-core';
import { inspectAction } from 'multisig/inspect';
import { predictSafeAddress } from 'multisig/legacyCalls';
import {
  contract,
  mockAccounts,
  mockTrial
} from '../../../multisig/tests/contractsMock';
import { CAROL, SAFE } from '../../display/fixtures';

const TARGET = predictSafeAddress(CAROL, 40);
const token = Buffer.from('WEGLD-a28c59');
const one = Uint8Array.of(1);

const call = (endpoint: string, args: Uint8Array[]) => ({
  name: 'SendAsyncCall',
  fields: [
    {
      to: TARGET,
      egld_amount: 0n,
      endpoint_name: Buffer.from(endpoint),
      arguments: args
    }
  ]
});

const redTexts = async (action: any) =>
  (await inspectAction(action, SAFE)).checks
    .filter((check) => check.tone === 'bad' && !check.advisory)
    .map((check) => check.text)
    .join(' ');

beforeEach(() => {
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: '11'.repeat(32) });
  mockTrial.answer = async () => ({ gasLimit: 3800000 });
});

test('control: a token sent with an ordinary function after it is not flagged', async () => {
  expect(
    await redTexts(call('ESDTTransfer', [token, one, Buffer.from('deposit')]))
  ).toBe('');
});

test('a built-in named after a token transfer is red, as it is on its own', async () => {
  const owner = Address.newFromBech32(CAROL).getPublicKey();
  expect(
    await redTexts(
      call('ESDTTransfer', [
        token,
        one,
        Buffer.from('ChangeOwnerAddress'),
        owner
      ])
    )
  ).toMatch(/ChangeOwnerAddress/);
});

test('the same after an NFT transfer on the safe itself', async () => {
  const receiver = Address.newFromBech32(TARGET).getPublicKey();
  const nft = {
    name: 'SendAsyncCall',
    fields: [
      {
        to: SAFE,
        egld_amount: 0n,
        endpoint_name: Buffer.from('ESDTNFTTransfer'),
        arguments: [
          Buffer.from('LKMEX-aab910'),
          one,
          one,
          receiver,
          Buffer.from('upgradeContract'),
          Uint8Array.of(0, 0x61, 0x73, 0x6d)
        ]
      }
    ]
  };
  expect(await redTexts(nft)).toMatch(/upgradeContract/);
});
