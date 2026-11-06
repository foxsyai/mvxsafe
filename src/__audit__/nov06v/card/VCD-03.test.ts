// VCD-03: a batch that mvxvest refuses is green on its card, and is used up
// after its signatures.
//
// The builder (vestingProblem) holds a batch to mvxvest's own rules before
// proposing it: a label of at most 64 bytes, at most 120 tranches, every
// tranche above zero and strictly later than the one before, a total that is
// the sum of its tranches, a schedule that starts at its first tranche and
// ends at its last, no beneficiary that is mvxvest itself or the zero address.
// The card (inspectVesting) checks none of these on a batch proposed by hand.
// It compares the payment with the sum of the totals, which such a batch pays
// exactly, so the card is green and says "pays exactly what mvxvest wants".
// Carried out, mvxvest refuses it (create.rs: ERR_LABEL_TOO_LONG,
// ERR_BAD_BENEFICIARY; schedule.rs: ERR_TRANCHE_COUNT, ERR_ZERO_TRANCHE,
// ERR_TRANCHE_ORDER, ERR_TRANCHE_SUM, ERR_LAST_TRANCHE_NOT_END,
// ERR_TRANCHE_BEFORE_START), the tokens come back and the action is used up.
//
// Expected: the card holds a hand-built batch to the same rules as the
// builder, in red.
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
import { topEncode } from 'multisig/legacyCalls';
import {
  encodeCreateBatchArgs,
  entryTotal,
  mvxvestFor,
  NewVesting,
  trancheSchedule,
  VestingFacts,
  vestingProblem
} from 'multisig/vesting';
import { ALICE, BOB, SAFE } from '../../display/fixtures';

const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const UNIT = 10n ** 18n;
const DAY = 86400;
const TOKEN = 'FOXSY-5d5f3e';
const pin = mvxvestFor('devnet')!;
const NOW = Math.floor(Date.now() / 1000);
const FIRST = NOW + 30 * DAY;
const ZERO_ADDRESS = Address.newFromHex('00'.repeat(32)).toBech32();

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
  safeBalance: 10_000_000n * UNIT,
  safeEgld: UNIT
};
const mockFacts: { current: VestingFacts } = { current: facts };

const sound: NewVesting = {
  beneficiary: ALICE,
  schedule: trancheSchedule([
    { time: FIRST, amount: 4n * UNIT },
    { time: FIRST + 182 * DAY, amount: 6n * UNIT }
  ])
};

/** The batch as a hand-built proposal: ESDTTransfer of the totals, createBatch after it. */
const actionOf = (entries: NewVesting[], label = 'Grants 2026') => {
  const paid = entries.reduce((sum, entry) => sum + entryTotal(entry), 0n);
  return {
    name: 'SendAsyncCall',
    fields: [
      {
        to: pin.address,
        egld_amount: 0n,
        endpoint_name: Buffer.from('ESDTTransfer'),
        arguments: [
          Buffer.from(TOKEN),
          Buffer.from(topEncode(paid)),
          Buffer.from('createBatch'),
          ...encodeCreateBatchArgs({ cancelable: true, label, entries }).map(
            (arg) => Buffer.from(arg)
          )
        ]
      }
    ]
  };
};
const red = <T extends { tone: string; advisory?: boolean }>(checks: T[]) =>
  checks.filter((check) => check.tone === 'bad' && !check.advisory);
const problemOf = (entries: NewVesting[], label = 'Grants 2026') =>
  vestingProblem({
    pin,
    facts,
    safe: SAFE,
    token: TOKEN,
    cancelable: true,
    label,
    entries,
    now: NOW
  });

/** Each case: what mvxvest refuses, as the builder refuses it too. */
const cases: [string, NewVesting[], string][] = [
  ['a label of 65 bytes (ERR_LABEL_TOO_LONG)', [sound], 'x'.repeat(65)],
  [
    '121 tranches (ERR_TRANCHE_COUNT)',
    [
      {
        beneficiary: ALICE,
        schedule: trancheSchedule(
          Array.from({ length: 121 }, (_, at) => ({
            time: FIRST + at * DAY,
            amount: UNIT
          }))
        )
      }
    ],
    'Grants 2026'
  ],
  [
    'a tranche of zero (ERR_ZERO_TRANCHE)',
    [
      {
        beneficiary: ALICE,
        schedule: trancheSchedule([
          { time: FIRST, amount: 0n },
          { time: FIRST + DAY, amount: 10n * UNIT }
        ])
      }
    ],
    'Grants 2026'
  ],
  [
    'two tranches at the same time (ERR_TRANCHE_ORDER)',
    [
      {
        beneficiary: ALICE,
        schedule: trancheSchedule([
          { time: FIRST, amount: 4n * UNIT },
          { time: FIRST, amount: 6n * UNIT }
        ])
      }
    ],
    'Grants 2026'
  ],
  [
    'a total that is not the sum of its tranches (ERR_TRANCHE_SUM)',
    [{ ...sound, total: 100n * UNIT }],
    'Grants 2026'
  ],
  [
    'a schedule ending after its last tranche (ERR_LAST_TRANCHE_NOT_END)',
    [
      {
        beneficiary: ALICE,
        schedule: { ...sound.schedule, end: FIRST + 365 * DAY }
      }
    ],
    'Grants 2026'
  ],
  [
    'a tranche before the schedule starts (ERR_TRANCHE_BEFORE_START)',
    [
      {
        beneficiary: ALICE,
        schedule: {
          ...sound.schedule,
          start: FIRST + DAY,
          cliff: FIRST + DAY
        }
      }
    ],
    'Grants 2026'
  ],
  [
    'the zero address as beneficiary (ERR_BAD_BENEFICIARY)',
    [{ ...sound, beneficiary: ZERO_ADDRESS }],
    'Grants 2026'
  ],
  [
    'mvxvest itself as beneficiary (ERR_BAD_BENEFICIARY)',
    [{ ...sound, beneficiary: pin.address }],
    'Grants 2026'
  ]
];

describe('VCD-03: a hand-built batch mvxvest will refuse', () => {
  it('control: the sound batch passes the builder and is green on the card', async () => {
    expect(problemOf([sound, { ...sound, beneficiary: BOB }])).toBe('');
    const { checks } = await inspectAction(
      actionOf([sound, { ...sound, beneficiary: BOB }]),
      SAFE
    );
    expect(red(checks)).toEqual([]);
  });

  it.each(cases)('control: the builder refuses %s', (_what, entries, label) => {
    expect(problemOf(entries, label)).not.toBe('');
  });

  it.each(cases)('the card is red for %s', async (_what, entries, label) => {
    const { checks } = await inspectAction(actionOf(entries, label), SAFE);
    expect(red(checks)).not.toEqual([]);
  });
});
