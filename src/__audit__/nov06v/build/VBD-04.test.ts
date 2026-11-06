/**
 * @jest-environment node
 *
 * VBD-04 (high): a cancel is given a flat 10M whatever the vesting, and a
 * cancel of a vesting of many tranches needs several times that, so the
 * carry-out runs out in mvxvest and the action is used up with every
 * signature; the key goes back to the safe, nothing is lost but the action
 * and the gas.
 *
 * cancel() loads the whole vesting from storage, its schedule included, and
 * that decode has the same growing cost per tranche as the creation (VBD-03).
 * Measured by simulation on 6 Nov 2026 from a wallet in the contract's shard,
 * on a v4 copy on devnet (audit-2026-11-06-vest/build/sim/cancel-sim.mjs),
 * for two vestings created in the real transaction
 * 37990d50940f489b02e1b27c381a2abd1171035a824ec8a47d226f4a753e717a:
 *
 *   cancel of the 1-tranche vesting      6,231,306 gas   (the shipped 6.3M)
 *   cancel of the 120-tranche vesting   57,259,951 gas
 *
 * The data of a cancel moves for 251,000 of that; the rest runs the contract.
 * The app's cancel budget is 26.5M in all (CANCEL_GAS_NEED 10M plus a fifth,
 * the safe's 7.5M and the callback's 7M): the plan itself says 12M is for the
 * call, and the real carry-out #36 forwarded 13.4M to mvxvest. A vesting of
 * about 40 monthly tranches or more cannot be cancelled from a safe through
 * mvxsafe as it is, and the signers learn it only after the perform.
 *
 * Correct behaviour, asserted here through the card's own figure, so that a
 * larger constant or a need sized from the vesting read both pass: what the
 * plan gives the call of a cancel is never under what the cancel needs for
 * that vesting; a 1-tranche vesting keeps passing.
 */
jest.mock('multisig/network', () => {
  const base =
    require('../../../multisig/tests/contractsMock').contractsNetworkMock;
  return {
    ...base,
    networkName: 'devnet',
    api: async (path: string) => {
      if (/^\/accounts\/[^/]+\/nfts\/.+$/.test(path))
        return { identifier: path.split('/').pop(), balance: '1' };
      return base.api(path);
    }
  };
});
jest.mock('multisig/vestingReads', () => ({
  ...jest.requireActual('multisig/vestingReads'),
  readVestingFacts: jest.fn(async () => facts),
  readVestingOfCancelKey: jest.fn(async (_pin: unknown, nonce: number) =>
    nonce === 3 ? vestingOf(120, 3) : vestingOf(1, 4)
  )
}));
jest.mock('multisig/describe', () => ({
  ...jest.requireActual('multisig/describe'),
  readTokenMeta: async () => ({ decimals: 18, ticker: 'TSAFED' })
}));

import { performPlan } from 'multisig/gas';
import {
  mvxvestFor,
  trancheSchedule,
  VestingCall,
  VestingFacts
} from 'multisig/vesting';
import { inspectVesting } from 'multisig/vestingCard';
import type { VestingState } from 'multisig/vestingReads';

const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const WALLET = 'erd1vsfzda20hmvjc7f7mymvyff5gusql04yug2ehtchrdalj2dad85q3685a5';
const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const UNIT = 10n ** 13n;
const MONTH = 2629800;
const NOW = 1793961456;
const pin = mvxvestFor('devnet')!;

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
  safeBalance: 0n,
  safeEgld: 10n ** 18n
};

/** A vesting of `tranches` monthly tranches, half of them in the past, as getVesting reports it. */
const vestingOf = (tranches: number, id: number): VestingState => {
  const first = NOW - Math.floor(tranches / 2) * MONTH;
  const schedule = trancheSchedule(
    Array.from({ length: tranches }, (_, at) => ({
      time: first + at * MONTH,
      amount: UNIT
    }))
  );
  const vested =
    BigInt(Math.floor(tranches / 2) + (tranches === 1 ? 0 : 1)) * UNIT;
  return {
    id,
    creator: SAFE,
    beneficiary: WALLET,
    token: 'TSAFED-e52b18',
    total: BigInt(tranches) * UNIT,
    schedule,
    cancelable: true,
    createdAt: NOW - 3600,
    claimNonce: id,
    cancelNonce: id,
    label: 'audit',
    claimed: 0n,
    cancelledAt: 0,
    vested,
    claimable: vested,
    finalAmount: BigInt(tranches) * UNIT,
    refunded: 0n,
    timestamp: NOW
  };
};

const cancelOf = (nonce: number): VestingCall => ({
  kind: 'cancel',
  contract: pin.address,
  keys: [{ token: pin.cancelKey, nonce: BigInt(nonce), amount: 1n }]
});

/** What the plan gives the call of this cancel, from the card's own need. */
const givenToTheCall = async (nonce: number) => {
  const inspection = await inspectVesting(cancelOf(nonce), SAFE, NOW);
  expect(inspection.checks.some((check) => check.tone === 'bad')).toBe(false);
  const plan = performPlan({
    name: 'SendAsyncCall',
    callNeed: inspection.need
  });
  if (plan.simulate)
    throw new Error('a cancel carry-out is budgeted, not simulated');
  return plan.parts.call;
};

describe('VBD-04: the gas a cancel is given', () => {
  it('control: a cancel of a 1-tranche vesting gets what it needs (6,231,306 simulated)', async () => {
    expect(await givenToTheCall(4)).toBeGreaterThanOrEqual(
      6_231_306n - 251_000n
    );
  });

  it('a cancel of a 120-tranche vesting gets what it needs (57,259,951 simulated)', async () => {
    expect(await givenToTheCall(3)).toBeGreaterThanOrEqual(
      57_259_951n - 251_000n
    );
  });
});
