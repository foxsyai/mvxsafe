// VCD-02: a release at the cliff of a tranche schedule is neither listed nor
// said, so a "vesting" that pays almost everything at once reads like one that
// pays over years.
//
// mvxvest's schedule has a cliff amount that unlocks at the cliff, on top of
// what the curve releases (schedule.rs: validate accepts a tranche schedule
// when the tranches plus cliff_amount add up to the total; vested_at pays
// cliff_amount from the cliff on, and the cliff may be in the past). The app
// never proposes one: vestingProblem refuses a tranche schedule whose cliff
// amount is not zero or whose start, cliff and end are not its first and last
// tranche. The card does not hold a hand-built batch to that rule. Its list
// shows the tranches only, its "has passed" line looks at tranche dates only,
// and no check reads the cliff.
//
// So a batch built by hand with a total of 1,000,000, a cliff of 999,990 one
// minute from now and a single tranche of 10 in nine years is green, pays
// exactly what mvxvest wants, lists "<date in nine years>: 10" under
// "1,000,000", and once carried out the beneficiary claims 999,990 at once.
//
// Expected: red for a tranche schedule the app would refuse, naming the
// cliff, and the cliff release in the list with its date and amount.
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
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { VestingDetails } from 'components/Pending/VestingDetails';
import { inspectAction } from 'multisig/inspect';
import { topEncode } from 'multisig/legacyCalls';
import {
  encodeCreateBatchArgs,
  mvxvestFor,
  NewVesting,
  trancheSchedule,
  VestingFacts,
  vestingProblem
} from 'multisig/vesting';
import { ALICE, SAFE } from '../../display/fixtures';

const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const UNIT = 10n ** 18n;
const DAY = 86400;
const TOKEN = 'FOXSY-5d5f3e';
const pin = mvxvestFor('devnet')!;
const NOW = Math.floor(Date.now() / 1000);
const SOON = NOW + 60;
const FAR = NOW + 9 * 365 * DAY;
const when = (seconds: number) =>
  `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

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

/** What the app proposes: 1,000,000 in two tranches, nothing at the cliff. */
const honest: NewVesting = {
  beneficiary: ALICE,
  schedule: trancheSchedule([
    { time: SOON + 365 * DAY, amount: 500_000n * UNIT },
    { time: FAR, amount: 500_000n * UNIT }
  ])
};

/**
 * Built by hand: the same total, 999,990 of it at a cliff one minute from
 * now and 10 in nine years. mvxvest accepts it (10 + 999,990 = 1,000,000,
 * start <= cliff <= end, the last tranche at end).
 */
const hidden: NewVesting = {
  beneficiary: ALICE,
  total: 1_000_000n * UNIT,
  schedule: {
    start: SOON,
    cliff: SOON,
    cliffAmount: 999_990n * UNIT,
    end: FAR,
    curve: { kind: 'tranches', tranches: [{ time: FAR, amount: 10n * UNIT }] }
  }
};

/** ESDTTransfer of the total to the pinned mvxvest, createBatch after it. */
const actionOf = (entry: NewVesting) => ({
  name: 'SendAsyncCall',
  fields: [
    {
      to: pin.address,
      egld_amount: 0n,
      endpoint_name: Buffer.from('ESDTTransfer'),
      arguments: [
        Buffer.from(TOKEN),
        Buffer.from(topEncode(1_000_000n * UNIT)),
        Buffer.from('createBatch'),
        ...encodeCreateBatchArgs({
          cancelable: true,
          label: 'Grants 2026',
          entries: [entry]
        }).map((arg) => Buffer.from(arg))
      ]
    }
  ]
});
const red = <T extends { tone: string; advisory?: boolean }>(checks: T[]) =>
  checks.filter((check) => check.tone === 'bad' && !check.advisory);
const texts = (checks: { text: string }[]) =>
  checks.map((check) => check.text).join('\n');

describe('VCD-02: a tranche schedule with a cliff amount', () => {
  it('control: the builder refuses it, as it refuses every schedule not shaped by its tranches', () => {
    expect(
      vestingProblem({
        pin,
        facts,
        safe: SAFE,
        token: TOKEN,
        cancelable: true,
        label: 'Grants 2026',
        entries: [hidden],
        now: NOW
      })
      // The fix words the refusal for what it is, the cliff release (main
      // session, 6 Nov 2026); the control's point, that the builder refuses
      // it, is unchanged.
    ).toMatch(/unlocks at its cliff|does not start at its first tranche/);
  });

  it('control: the schedule the app proposes is green and every release is listed', async () => {
    const inspection = await inspectAction(actionOf(honest), SAFE);
    expect(red(inspection.checks)).toEqual([]);
    const { container } = render(
      <VestingDetails details={inspection.vesting!} />
    );
    expect(container.textContent).toContain('500,000');
    expect(container.textContent).toContain(`${when(FAR)}: 500,000`);
  });

  it('is said in red: the app never proposes it, and the cliff releases what the list does not show', async () => {
    const inspection = await inspectAction(actionOf(hidden), SAFE);
    expect(texts(red(inspection.checks))).toMatch(/cliff/i);
  });

  it('lists the cliff release with its date and amount, like every tranche', async () => {
    const inspection = await inspectAction(actionOf(hidden), SAFE);
    expect(inspection.vesting).toMatchObject({ kind: 'create' });
    const { container } = render(
      <VestingDetails details={inspection.vesting!} />
    );
    expect(container.textContent).toContain(`${when(FAR)}: 10`);
    expect(container.textContent).toContain('999,990');
    expect(container.textContent).toContain(when(SOON));
  });
});
