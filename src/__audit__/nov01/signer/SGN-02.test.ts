// SGN-02: on a call to a SYSTEM contract (the ESDT/staking/governance contracts),
// the pending card shows an amber check that says
//   "The safe does not own the contract it calls; its owner is erd1...zllls8a5w6u.
//    Owner-only functions will refuse it."
// That claim is FALSE for the one thing a safe actually sends to the ESDT system
// contract: token-management calls (setSpecialRole, transferOwnership,
// controlChanges...). Their authority comes from owning the TOKEN, not from owning
// the system contract: a safe that owns the token can call them and they SUCCEED.
// (The system contract is not "owned" in the sense this check means; it reports
// itself as its own owner, so the check misfires on every call to it.)
//
// Worse, the card says this in the SAME breath as the green trial "Tried just now
// as the safe would send it: it works": the app tells the signer both that the
// call works and that it will be refused. A signer who trusts "it will refuse" may
// sign a call that in fact hands the token away or halts all its transfers.
//
// inspect.ts pushes the ownership check for any `isSmartContract(to) && to !== safe`
// whose API owner !== safe (inspect.ts:558-574). A system contract reports itself
// as its owner, so the false line always fires. The fix: do not emit the
// contract-ownership check when isSystemContract(to) (the system-contract red check
// already covers it, correctly).
//
// The control shows the mechanism is right for an ORDINARY contract the safe does
// not own, where an owner-only endpoint genuinely IS refused.
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);

import { Address } from '@multiversx/sdk-core';
import { inspectAction } from 'multisig/inspect';
import { isSystemContract, predictSafeAddress } from 'multisig/legacyCalls';
import {
  contract,
  mockAccounts,
  mockTrial
} from '../../../multisig/tests/contractsMock';
import { CAROL, SAFE } from '../../display/fixtures';

const ESDT_SC =
  'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzllls8a5w6u';
// An ordinary contract the safe does NOT own (owner = carol).
const FOREIGN = predictSafeAddress(CAROL, 7);
const u8 = (t: string) => Uint8Array.from(Buffer.from(t));
const pk = (b: string) => Address.newFromBech32(b).getPublicKey();

const call = (to: string, endpoint: string, args: Uint8Array[]) => ({
  name: 'SendAsyncCall',
  fields: [
    { to, egld_amount: 0n, endpoint_name: u8(endpoint), arguments: args }
  ]
});

const REFUSE = /Owner-only functions will refuse it/i;

beforeEach(() => {
  // The real API reports the ESDT system contract as its own owner.
  mockAccounts[ESDT_SC] = contract({ owner: ESDT_SC, hash: '22'.repeat(32) });
  mockAccounts[FOREIGN] = contract({ owner: CAROL, hash: '33'.repeat(32) });
  // As on chain when the safe owns the token: the call simulates as working.
  mockTrial.answer = async () => ({ gasLimit: 3800000 });
});

const checksFor = async (action: any) =>
  (await inspectAction(action, SAFE)).checks;

test('the ESDT system contract really is a system contract (premise)', () => {
  expect(isSystemContract(ESDT_SC)).toBe(true);
  expect(isSystemContract(FOREIGN)).toBe(false);
});

test('control: an owner-only call to an ORDINARY unowned contract is rightly told it will be refused', async () => {
  const checks = await checksFor(call(FOREIGN, 'setFee', [u8('\x0a')]));
  // The safe does not own FOREIGN, so "owner-only functions will refuse it" is TRUE here.
  expect(checks.some((c) => REFUSE.test(c.text))).toBe(true);
});

test('setSpecialRole(ESDTTransferRole) on the ESDT system contract must not be called a refusal', async () => {
  // On chain this grants the transfer role and HALTS ALL TRANSFERS of the token;
  // it does not "refuse". The trial even reports it works.
  const checks = await checksFor(
    call(ESDT_SC, 'setSpecialRole', [
      u8('TOKEN-abc123'),
      pk(CAROL),
      u8('ESDTTransferRole')
    ])
  );
  const trialWorks = checks.some(
    (c) => c.tone === 'ok' && /it works/i.test(c.text)
  );
  expect(trialWorks).toBe(true);
  // The card must not simultaneously claim the call will be refused.
  expect(checks.some((c) => REFUSE.test(c.text))).toBe(false);
});

test('transferOwnership on the ESDT system contract must not be called a refusal', async () => {
  const checks = await checksFor(
    call(ESDT_SC, 'transferOwnership', [u8('TOKEN-abc123'), pk(CAROL)])
  );
  expect(checks.some((c) => REFUSE.test(c.text))).toBe(false);
});
