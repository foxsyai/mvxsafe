// SGN-03: granting the transfer role on a token HALTS EVERY TRANSFER of that token
// for everyone (deposits to exchanges and contracts included), until the role is
// removed -- it is a token-wide freeze, not a permission handed to one address.
// This is an ESDT protocol behaviour of the transfer role, demonstrable on chain.
//
// A rogue proposer (or a board member steering the others) proposes
//   SendAsyncCall(ESDT system contract, "setSpecialRole", token, <addr>, "ESDTTransferRole")
// The card decodes the arguments correctly, but the only risk line it shows is the
// GENERIC system-contract red: "...can change who may mint, burn, freeze or own a
// token. It can also move stake." Nothing tells the signer that THIS call stops
// all transfers of the token. A signer reads "give <addr> a transfer role" and
// approves what is in effect a freeze of the whole token.
//
// This is the "token facts: does a signer know what the token's owner can do?"
// gap. The card says less than the contract does. Fix: decode the known ESDT
// system-contract token operations and spell out their real effect -- in
// particular, setSpecialRole(..., ESDTTransferRole) must say it halts all
// transfers of the token until the role is removed.
//
// The control shows the generic system-contract detection works (so the failing
// assertion is specifically about the MISSING transfer-halt disclosure, not about
// failing to notice the system contract at all).
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);

import { Address } from '@multiversx/sdk-core';
import { inspectAction } from 'multisig/inspect';
import {
  contract,
  mockAccounts,
  mockTrial
} from '../../../multisig/tests/contractsMock';
import { CAROL, SAFE } from '../../display/fixtures';

const ESDT_SC =
  'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzllls8a5w6u';
const u8 = (t: string) => Uint8Array.from(Buffer.from(t));
const pk = (b: string) => Address.newFromBech32(b).getPublicKey();

const call = (endpoint: string, args: Uint8Array[]) => ({
  name: 'SendAsyncCall',
  fields: [
    {
      to: ESDT_SC,
      egld_amount: 0n,
      endpoint_name: u8(endpoint),
      arguments: args
    }
  ]
});

beforeEach(() => {
  mockAccounts[ESDT_SC] = contract({ owner: ESDT_SC, hash: '22'.repeat(32) });
  mockTrial.answer = async () => ({ gasLimit: 3800000 });
});

const checksText = async (action: any) =>
  (await inspectAction(action, SAFE)).checks.map((c) => c.text).join(' ‖ ');

// Transfers being stopped/halted/frozen/blocked, for the token.
const HALTS_TRANSFERS =
  /transfers?\b[^‖]*\b(halt|stop|freez|block|no longer|cannot|disabl|everyone)/i;

test('control: a setSpecialRole call is recognised as a system-contract call (generic red present)', async () => {
  const text = await checksText(
    call('setSpecialRole', [
      u8('TOKEN-abc123'),
      pk(CAROL),
      u8('ESDTRoleLocalMint')
    ])
  );
  expect(/system contract/i.test(text)).toBe(true);
});

test('granting ESDTTransferRole must disclose that it halts all transfers of the token', async () => {
  const text = await checksText(
    call('setSpecialRole', [
      u8('TOKEN-abc123'),
      pk(CAROL),
      u8('ESDTTransferRole')
    ])
  );
  expect(HALTS_TRANSFERS.test(text)).toBe(true);
});
