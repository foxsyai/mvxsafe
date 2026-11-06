// VCD-06: a vesting whose beneficiary is a contract gets no word on the card.
//
// mvxvest sends each beneficiary a claim key, an NFT, with a plain transfer
// (create.rs, deliver_keys). A contract can use that key only if its code can
// send it back to mvxvest with claim(); a safe made with mvxsafe cannot, since
// the call form refuses every token transfer. In another shard a contract that
// is not payable by smart contracts bounces the key back to mvxvest, where
// only mvxvest's owner can move it (claim.rs, recoverBouncedKey). So a
// vesting to a contract is one nobody may ever be able to claim: cancelable,
// its tokens come back only through a cancel; not cancelable, they are locked
// for good. The builder does not refuse a contract beneficiary either, so a
// pasted contract address reaches the board with nothing said.
//
// The card lists the beneficiary's address and nothing else: a signer has to
// know that erd1qqqqqqqqqqqqqpgq... is a contract.
//
// Expected: a line, amber at least, saying the beneficiary is a contract.
jest.mock('multisig/network', () => {
  const base =
    require('../../../multisig/tests/contractsMock').contractsNetworkMock;
  return { ...base };
});
jest.mock('multisig/vestingReads', () => ({
  ...jest.requireActual('multisig/vestingReads'),
  readVestingFacts: jest.fn(async () => mockFacts.current),
  readVestingOfCancelKey: jest.fn(async () => null)
}));

import '../../display/restoreSetImmediate';
import { Address } from '@multiversx/sdk-core';
import { inspectAction } from 'multisig/inspect';
import { predictSafeAddress, topEncode } from 'multisig/legacyCalls';
import {
  encodeCreateBatchArgs,
  mvxvestFor,
  NewVesting,
  trancheSchedule,
  VestingFacts
} from 'multisig/vesting';
import { ALICE, CAROL, SAFE } from '../../display/fixtures';

const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const UNIT = 10n ** 18n;
const DAY = 86400;
const TOKEN = 'FOXSY-5d5f3e';
const pin = mvxvestFor('devnet')!;
const NOW = Math.floor(Date.now() / 1000);
const FIRST = NOW + 30 * DAY;
/** Another contract: a safe someone else deployed. */
const CONTRACT = predictSafeAddress(CAROL, 40);

const facts: VestingFacts = {
  codeHash: V4,
  creationPaused: false,
  claimKeyIssued: true,
  cancelKeyIssued: true,
  claimKeyCollection: pin.claimKey,
  cancelKeyCollection: pin.cancelKey,
  fee: 0n,
  tokenFeeBps: 0,
  safePayableBySc: true,
  safeBalance: 1000n * UNIT,
  safeEgld: UNIT
};
const mockFacts: { current: VestingFacts } = { current: facts };

const vestingTo = (beneficiary: string): NewVesting => ({
  beneficiary,
  schedule: trancheSchedule([
    { time: FIRST, amount: 4n * UNIT },
    { time: FIRST + 182 * DAY, amount: 6n * UNIT }
  ])
});
const actionOf = (entries: NewVesting[]) => ({
  name: 'SendAsyncCall',
  fields: [
    {
      to: pin.address,
      egld_amount: 0n,
      endpoint_name: Buffer.from('ESDTTransfer'),
      arguments: [
        Buffer.from(TOKEN),
        Buffer.from(topEncode(10n * UNIT * BigInt(entries.length))),
        Buffer.from('createBatch'),
        ...encodeCreateBatchArgs({
          cancelable: true,
          label: 'Grants 2026',
          entries
        }).map((arg) => Buffer.from(arg))
      ]
    }
  ]
});
/** A line that is not green and names the beneficiary as a contract. */
const warned = (checks: { tone: string; text: string }[], address: string) =>
  checks.filter(
    (check) =>
      check.tone !== 'ok' &&
      check.text.includes(address) &&
      /contract/i.test(check.text)
  );

describe('VCD-06: a beneficiary that is a contract', () => {
  it('control: the address is a contract, and a wallet beneficiary gets no such line', async () => {
    expect(Address.newFromBech32(CONTRACT).isSmartContract()).toBe(true);
    expect(Address.newFromBech32(ALICE).isSmartContract()).toBe(false);
    const { checks } = await inspectAction(actionOf([vestingTo(ALICE)]), SAFE);
    expect(warned(checks, ALICE)).toEqual([]);
  });

  it('is said on the card, amber at least, with the address', async () => {
    const { checks } = await inspectAction(
      actionOf([vestingTo(ALICE), vestingTo(CONTRACT)]),
      SAFE
    );
    expect(warned(checks, CONTRACT)).not.toEqual([]);
  });
});
