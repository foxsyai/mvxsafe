// RED-02 (redteam audit, 1 Nov 2026): the safe's own dnsRegister is an EGLD
// sink, and the sentence reads as a call on the safe itself.
//
// The deployed multisig has dnsRegister(dns_address, name): owner only,
// payable in EGLD, and it forwards the EGLD it is sent to `dns_address` as a
// call register(name). The safe owns itself, so the one caller the owner
// check lets through is the safe, through its own proposeAsyncCall or
// proposeTransferExecute with `to` = the safe. The devnet VM confirms it
// without a transaction (proofs/RED-02.mjs, the app's own cost trial): the
// safe calling itself with 0.01 xEGLD and a wallet as dns_address produces a
// smart contract result moving the 0.01 xEGLD from the safe to that wallet.
//
// What the signer reads today:
//   "Call dnsRegister(erd1...wallet, zzzname [or the number ...]) on this safe
//    itself, sending 0.01 EGLD with it. Do not sign without checking it in the
//    explorer."
// Money leaves the safe to the address given as the first argument, and the
// sentence says the EGLD is sent to the safe itself. The checks under it are
// amber at worst (the trial cannot measure it). A board member can file it
// from the Call form: the safe's address is a contract address, dnsRegister
// is not a built-in, and the trial does not refuse it.
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);

import { Address } from '@multiversx/sdk-core';
import { describeAction } from 'multisig/describe';
import { inspectAction } from 'multisig/inspect';
import { ALICE, SAFE, utf8 } from '../../display/fixtures';

const EGLD = 10n ** 16n; // 0.01 EGLD

const selfCall = (name: 'SendAsyncCall' | 'SendTransferExecute') => ({
  name,
  fields: [
    {
      to: SAFE,
      egld_amount: EGLD,
      endpoint_name: utf8('dnsRegister'),
      arguments: [Address.newFromBech32(ALICE).getPublicKey(), utf8('zzzname')]
    }
  ]
});

test('control: a plain EGLD transfer names the wallet that receives it, with no red check', async () => {
  const action = {
    name: 'SendTransferExecute',
    fields: [
      {
        to: ALICE,
        egld_amount: EGLD,
        endpoint_name: new Uint8Array(0),
        arguments: []
      }
    ]
  };
  expect(await describeAction(action, SAFE)).toBe(`Send 0.01 EGLD to ${ALICE}`);
  const { checks } = await inspectAction(action, SAFE);
  expect(checks.some((check) => check.tone === 'bad')).toBe(false);
});

describe.each(['SendAsyncCall', 'SendTransferExecute'] as const)(
  'dnsRegister on the safe itself, as a %s',
  (kind) => {
    test('the sentence says where the EGLD goes, not that the safe sends it to itself', async () => {
      const sentence = await describeAction(selfCall(kind), SAFE);
      expect(sentence).toMatch(/0\.01 EGLD/);
      // The money's real destination, said as a destination.
      expect(sentence).toMatch(
        new RegExp(
          `(\\bto\\b|receives|gets|paid to)[^.]*${ALICE}|${ALICE}[^.]*(receives|gets)`
        )
      );
      // And not as a payment the safe makes to itself.
      expect(sentence).not.toMatch(/on this safe itself, sending/);
    });

    test('the card carries a red check for EGLD leaving through a call on the safe itself', async () => {
      const { checks } = await inspectAction(selfCall(kind), SAFE);
      expect(
        checks.some(
          (check) =>
            check.tone === 'bad' &&
            /EGLD|forward|dnsRegister|leave/i.test(check.text)
        )
      ).toBe(true);
    });
  }
);
