// SGN-04: a controlChanges call that sets canUpgrade=false on a token is
// IRREVERSIBLE -- after it, the token's properties (pause, freeze, wipe, mint,
// burn, add-roles...) can never be changed again, by anyone. This is the same
// one-way lock the app already shouts about for an upgrade that drops the
// "upgradeable" flag: SCUpgradeFromSource / upgradeContract say "it can never be
// changed again, by anyone" (UPG-02). Reached through the ESDT system contract as
//   SendAsyncCall(ESDT system contract, "controlChanges", token, "canUpgrade", "false")
// the card says only the generic system-contract red and prints the raw arguments
// ("canUpgrade, false [or the number ...]"); not one word that it is permanent.
//
// A signer who would never sign away upgradeability on a contract is given no such
// warning when the identical, irreversible act is dressed as a token-settings
// call. Card says less than the contract does.
//
// Fix: decode controlChanges; when it sets canUpgrade=false, warn (in red) that
// the token's settings become permanent and can never be changed again -- the same
// language the upgrade path already uses.
//
// Control: a controlChanges that keeps canUpgrade=true is not permanent and need
// not carry the warning (it still gets the generic system-contract red).
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);

import { inspectAction } from 'multisig/inspect';
import {
  contract,
  mockAccounts,
  mockTrial
} from '../../../multisig/tests/contractsMock';
import { SAFE } from '../../display/fixtures';

const ESDT_SC =
  'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzllls8a5w6u';
const u8 = (t: string) => Uint8Array.from(Buffer.from(t));

const controlChanges = (flag: string, value: string) => ({
  name: 'SendAsyncCall',
  fields: [
    {
      to: ESDT_SC,
      egld_amount: 0n,
      endpoint_name: u8('controlChanges'),
      arguments: [u8('TOKEN-abc123'), u8(flag), u8(value)]
    }
  ]
});

beforeEach(() => {
  mockAccounts[ESDT_SC] = contract({ owner: ESDT_SC, hash: '22'.repeat(32) });
  mockTrial.answer = async () => ({ gasLimit: 3800000 });
});

const checksText = async (action: any) =>
  (await inspectAction(action, SAFE)).checks.map((c) => c.text).join(' ‖ ');

const PERMANENT =
  /permanent|never (be )?(changed|undone)|cannot be undone|irreversible/i;

test('control: keeping canUpgrade=true is still a system-contract call and not permanent', async () => {
  const text = await checksText(controlChanges('canUpgrade', 'true'));
  expect(/system contract/i.test(text)).toBe(true);
  expect(PERMANENT.test(text)).toBe(false);
});

test('controlChanges canUpgrade=false must warn that the token is locked for good', async () => {
  const text = await checksText(controlChanges('canUpgrade', 'false'));
  expect(PERMANENT.test(text)).toBe(true);
});
