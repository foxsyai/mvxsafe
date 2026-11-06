// VCD-01: EGLD carried with a vesting action is said nowhere on its card.
//
// Every call the safe stores has an EGLD amount next to its data (egld_amount).
// A proposal built by hand can put 100 EGLD there with the very bytes the app
// would propose: ESDTTransfer with createBatch after it, the safe's own
// MultiESDTNFTTransfer that pays both fees, or the ESDTNFTTransfer of a cancel
// key. Every other call sentence ends ", sending 100 EGLD with it"; the vesting
// sentence returns before that line and says nothing. The vesting checks never
// read the EGLD, and the self-call check lets a token move on the safe through
// whatever EGLD it carries. So the card is green, and its signers approve
// 100 EGLD they were never told about.
//
// Carried out, the network refuses a built-in token transfer that carries EGLD
// (checkBasicESDTArguments in the VM's built-in functions), so the EGLD stays
// and the action is used up after its signatures.
//
// Expected: the sentence says the EGLD, as every other call's does, and a red
// check says mvxsafe never proposes it.
jest.mock('multisig/network', () => {
  const base =
    require('../../../multisig/tests/contractsMock').contractsNetworkMock;
  return {
    ...base,
    api: async (path: string) => {
      const held = /^\/accounts\/[^/]+\/nfts\/(.+)$/.exec(path);
      if (held) return { identifier: held[1], balance: '1' };
      return base.api(path);
    }
  };
});
jest.mock('multisig/vestingReads', () => ({
  ...jest.requireActual('multisig/vestingReads'),
  readVestingFacts: jest.fn(async () => mockFacts.current),
  readVestingOfCancelKey: jest.fn(async () => mockVesting.current)
}));

import '../../display/restoreSetImmediate';
import { Address } from '@multiversx/sdk-core';
import { describeAction } from 'multisig/describe';
import { inspectAction } from 'multisig/inspect';
import {
  buildProposeCancelVesting,
  buildProposeVestings,
  mvxvestFor,
  trancheSchedule,
  VestingFacts
} from 'multisig/vesting';
import type { VestingState } from 'multisig/vestingReads';
import { ALICE, BOB, SAFE } from '../../display/fixtures';

const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const UNIT = 10n ** 18n;
const DAY = 86400;
const TOKEN = 'FOXSY-5d5f3e';
const pin = mvxvestFor('devnet')!;
const NOW = Math.floor(Date.now() / 1000);
const FIRST = NOW + 30 * DAY;
const HUNDRED_EGLD = 100n * UNIT;

const factsWith = (over: Partial<VestingFacts> = {}): VestingFacts => ({
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
  safeEgld: 1000n * UNIT,
  ...over
});
const mockFacts: { current: VestingFacts } = { current: factsWith() };
const mockVesting: { current: VestingState | null } = { current: null };
const WITH_FEES = { fee: 10n ** 17n, tokenFeeBps: 10 };

const entries = [
  {
    beneficiary: ALICE,
    schedule: trancheSchedule([
      { time: FIRST, amount: 4n * UNIT },
      { time: FIRST + 182 * DAY, amount: 6n * UNIT }
    ])
  },
  {
    beneficiary: BOB,
    schedule: trancheSchedule([{ time: FIRST, amount: 6n * UNIT }])
  }
];
const context = { chainId: 'D', sender: ALICE, nonce: 1, safe: SAFE };
const batch = (facts: VestingFacts = factsWith()) =>
  buildProposeVestings(context, {
    pin,
    facts,
    token: TOKEN,
    cancelable: true,
    label: 'Grants 2026',
    entries,
    now: NOW
  });
const cancel = () =>
  buildProposeCancelVesting(context, {
    pin,
    facts: factsWith(),
    collection: pin.cancelKey,
    nonce: 5
  });

/**
 * The proposal's data as the safe stores it and the card reads it back, with
 * the EGLD amount a hand-built proposal can set next to the same bytes.
 */
const actionOf = (transaction: { data: Uint8Array }, egld: bigint) => {
  const parts = Buffer.from(transaction.data).toString().split('@');
  return {
    name: 'SendAsyncCall',
    fields: [
      {
        to: Address.newFromHex(parts[1]).toBech32(),
        egld_amount: egld,
        endpoint_name: Buffer.from(parts[3], 'hex'),
        arguments: parts.slice(4).map((part) => Buffer.from(part, 'hex'))
      }
    ]
  };
};
const red = <T extends { tone: string; advisory?: boolean }>(checks: T[]) =>
  checks.filter((check) => check.tone === 'bad' && !check.advisory);

const state: VestingState = {
  id: 7,
  creator: SAFE,
  beneficiary: BOB,
  token: TOKEN,
  total: 10n * UNIT,
  schedule: trancheSchedule([
    { time: NOW - DAY, amount: 4n * UNIT },
    { time: NOW + 182 * DAY, amount: 6n * UNIT }
  ]),
  cancelable: true,
  createdAt: NOW - 10 * DAY,
  claimNonce: 9,
  cancelNonce: 5,
  label: 'Grants 2026',
  claimed: 0n,
  cancelledAt: 0,
  vested: 4n * UNIT,
  claimable: 4n * UNIT,
  finalAmount: 0n,
  refunded: 0n,
  timestamp: NOW
};

beforeEach(() => {
  mockFacts.current = factsWith();
  mockVesting.current = null;
});

describe('VCD-01: EGLD carried with a vesting action', () => {
  it('control: as the app proposes it, no EGLD, the sentence names none and the card is green', async () => {
    const action = actionOf(await batch(), 0n);
    expect(await describeAction(action, SAFE)).not.toMatch(/EGLD/);
    expect(red((await inspectAction(action, SAFE)).checks)).toEqual([]);
  });

  it('control: the same call to another contract than mvxvest still says its EGLD', async () => {
    const action = actionOf(await batch(), HUNDRED_EGLD);
    action.fields[0].to = ALICE;
    expect(await describeAction(action, SAFE)).toMatch(
      /sending 100 EGLD with it/
    );
  });

  it('a batch paid with ESDTTransfer and 100 EGLD next to it: the sentence says the EGLD', async () => {
    const action = actionOf(await batch(), HUNDRED_EGLD);
    expect(await describeAction(action, SAFE)).toMatch(/100 EGLD/);
  });

  it('a batch paid with ESDTTransfer and 100 EGLD next to it: a red check says so', async () => {
    const action = actionOf(await batch(), HUNDRED_EGLD);
    const { checks } = await inspectAction(action, SAFE);
    expect(red(checks).map((check) => check.text)).toEqual(
      expect.arrayContaining([expect.stringMatching(/EGLD/)])
    );
  });

  it('a batch paying fees through the safe itself, with 100 EGLD next to it: the sentence says the EGLD', async () => {
    mockFacts.current = factsWith(WITH_FEES);
    const action = actionOf(await batch(factsWith(WITH_FEES)), HUNDRED_EGLD);
    expect(action.fields[0].to).toBe(SAFE);
    expect(await describeAction(action, SAFE)).toMatch(/100 EGLD/);
  });

  it('a batch paying fees through the safe itself, with 100 EGLD next to it: a red check says so', async () => {
    mockFacts.current = factsWith(WITH_FEES);
    const action = actionOf(await batch(factsWith(WITH_FEES)), HUNDRED_EGLD);
    const { checks } = await inspectAction(action, SAFE);
    expect(red(checks).map((check) => check.text)).toEqual(
      expect.arrayContaining([expect.stringMatching(/EGLD/)])
    );
  });

  it('a cancel with 100 EGLD next to the key: the sentence says the EGLD', async () => {
    mockVesting.current = state;
    const action = actionOf(await cancel(), HUNDRED_EGLD);
    expect(await describeAction(action, SAFE)).toMatch(/100 EGLD/);
  });

  it('a cancel with 100 EGLD next to the key: a red check says so', async () => {
    mockVesting.current = state;
    const action = actionOf(await cancel(), HUNDRED_EGLD);
    const { checks } = await inspectAction(action, SAFE);
    expect(red(checks).map((check) => check.text)).toEqual(
      expect.arrayContaining([expect.stringMatching(/EGLD/)])
    );
  });
});
