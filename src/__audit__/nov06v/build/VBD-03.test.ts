/**
 * @jest-environment node
 *
 * VBD-03 (high): the gas formula gives too little to a vesting of many
 * tranches, so its carry-out runs out where mvxvest runs and the action is
 * used up with every signature.
 *
 * vestingGasNeed counts 0.5M a tranche, as if each tranche cost the same. It
 * does not: on mvxvest version 4 the cost of a tranche grows with the number
 * of tranches before it (the schedule is decoded, cloned, stored and logged
 * as a managed list), so a vesting of t tranches costs about 0.26M x t +
 * 0.0047M x t^2 on top of its own. Measured by simulation on 6 Nov 2026
 * (audit-2026-11-06-vest/build/sim/grid.mjs, the shipped vest-gas.mjs method:
 * a wallet in the contract's shard, a v4 copy with zero fees and no key
 * display, a 64-byte label, 7-byte amounts, monthly tranches), one cancelable
 * vesting cost, on the contract's side:
 *
 *   tranches   1     8    16    24    32    48    64    80    96   120
 *   gas (M)  12.6  14.8  17.9  21.8  26.3  37.3  51.0  67.4  86.5  120.1
 *
 * and one real transaction confirmed the simulation to the unit: a cancelable
 * batch of a 120-tranche and a 1-tranche vesting used 130,308,151 gas on the
 * copy (devnet 37990d50940f489b02e1b27c381a2abd1171035a824ec8a47d226f4a753e717a,
 * simulated 130,308,152).
 *
 * The formula's need for that batch is 91.5M, its carry-out budget 124.3M in
 * all, of which the plan itself says 109.8M is for the call (the rest is the
 * safe's own part and the callback): under the 123.1M the call needs there
 * even before the safe's own part is counted, which for a 2.5 KB action is
 * about 21M, not 7.5M (54.7M were kept in the safe's shard for the 7.8 KB
 * batch #34, 430M given, 375.3M forwarded). One vesting fails from about 70
 * tranches, 2 vestings of 90, 3 of 80, 5 of 60 (not cancelable) and 6 of 72
 * fail too; every shape in the shipped table, which stops at 24 tranches,
 * holds. A board vesting monthly over six years, or weekly over a year and a
 * half, would lose the action and pay the full gas for nothing.
 *
 * Correct behaviour, asserted here, by the shipped test's own standard
 * ("never less than devnet measured") extended to these shapes, and by the
 * plan's own split for the real batch: the need is never under what was
 * measured, and what the plan gives the call is never under what the call
 * used.
 */
import { performPlan, PerformPlan } from 'multisig/gas';
import { trancheSchedule, vestingGasNeed } from 'multisig/vesting';

/** What a plan says the call itself gets, after the safe's own part and the callback. */
const givenToTheCall = (plan: PerformPlan) => {
  if (plan.simulate)
    throw new Error('a vesting carry-out is budgeted, not simulated');
  return plan.parts.call;
};

const WALLET = 'erd1vsfzda20hmvjc7f7mymvyff5gusql04yug2ehtchrdalj2dad85q3685a5';
const FIRST = 1793961456;
const MONTH = 2629800;

const batch = (count: number, tranches: number) =>
  Array.from({ length: count }, () => ({
    beneficiary: WALLET,
    schedule: trancheSchedule(
      Array.from({ length: tranches }, (_, at) => ({
        time: FIRST + at * MONTH,
        amount: 10n ** 15n
      }))
    )
  }));

// [vestings, tranches each, cancelable, simulated gas], the simulation of
// 6 Nov 2026 on the devnet copy erd1qqqqqqqqqqqqqpgqunhaauldrd4sr73ks7a93tmmkyuxaj0mmg8sshugvn.
const HOLDS: [number, number, boolean, number][] = [
  [1, 24, true, 23_703_422],
  [1, 32, true, 28_661_382],
  [1, 48, true, 40_593_302],
  [5, 48, true, 181_130_381],
  [29, 8, true, 307_554_013],
  [1, 48, false, 38_409_129]
];
const UNDER: [number, number, boolean, number][] = [
  [1, 64, true, 55_213_222],
  [1, 72, true, 63_657_831],
  [1, 80, true, 72_547_492],
  [1, 96, true, 92_543_412],
  [1, 120, true, 127_577_292],
  [2, 60, true, 97_109_257],
  [2, 90, true, 164_047_156],
  [3, 80, true, 206_728_331],
  [5, 60, true, 234_695_081],
  [6, 72, true, 353_919_854],
  [1, 64, false, 53_029_049],
  [1, 120, false, 125_393_119],
  [5, 60, false, 224_286_568]
];

describe('VBD-03: the gas a vesting of many tranches is given', () => {
  it.each(HOLDS)(
    'control: %i vestings of %i tranches, cancelable %s: the need covers what devnet measured',
    (count, tranches, cancelable, measured) => {
      expect(
        Number(
          vestingGasNeed({
            entries: batch(count, tranches),
            cancelable,
            feesPaid: false
          })
        )
      ).toBeGreaterThanOrEqual(measured);
    }
  );

  it.each(UNDER)(
    '%i vestings of %i tranches, cancelable %s: the need is never less than devnet measured',
    (count, tranches, cancelable, measured) => {
      expect(
        Number(
          vestingGasNeed({
            entries: batch(count, tranches),
            cancelable,
            feesPaid: false
          })
        )
      ).toBeGreaterThanOrEqual(measured);
    }
  );

  it('the real batch of 6 Nov (120 + 1 tranches): what the plan gives the call covers what the call used', () => {
    // 130,308,151 used in all by the transaction, of which 50,000 + 1,500 a
    // byte of its 4,765 data bytes moved the data: the rest ran the contract.
    const usedByTheCall = 130_308_151n - (50_000n + 1_500n * 4_765n);
    const entries = [
      ...batch(1, 120),
      {
        beneficiary: WALLET,
        schedule: trancheSchedule([{ time: FIRST, amount: 10n ** 13n }])
      }
    ];
    const need = vestingGasNeed({ entries, cancelable: true, feesPaid: false });
    const plan = performPlan({ name: 'SendAsyncCall', callNeed: need });
    expect(givenToTheCall(plan)).toBeGreaterThanOrEqual(usedByTheCall);
  });

  it('control: the real batch #33 (2 vestings of 2 tranches, fees paid): the plan covers what mvxvest used', () => {
    // docs/vestings-from-a-safe.md: 25,076,346 used by mvxvest.
    const entries = Array.from({ length: 2 }, () => ({
      beneficiary: WALLET,
      schedule: trancheSchedule([
        { time: FIRST, amount: 10n ** 18n },
        { time: FIRST + 2 * 86400, amount: 10n ** 18n }
      ])
    }));
    const need = vestingGasNeed({ entries, cancelable: true, feesPaid: true });
    const plan = performPlan({ name: 'SendAsyncCall', callNeed: need });
    expect(givenToTheCall(plan)).toBeGreaterThanOrEqual(25_076_346n);
  });
});
