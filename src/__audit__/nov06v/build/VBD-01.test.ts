/**
 * @jest-environment node
 *
 * VBD-01 (low, latent): a tranche time that is not a whole number of seconds
 * passes every check of vestingProblem and is then encoded as ANOTHER time.
 *
 * sdk-core's top encoding of a u64 takes the hexadecimal text of the number;
 * for 1793961456.7 that is "6aedadf0.b33...", the byte parser stops at the
 * dot and keeps "06aedadf", which is 112,188,127: 23 July 1973. Because
 * trancheSchedule copies the same number into start, cliff and end, the
 * encoded schedule is consistent and mvxvest accepts it: the vesting is
 * created with every date in 1973, fully vested the moment it is carried
 * out, and if it is not cancelable there is no way back. vestingProblem
 * compares the numbers as given (1793961456.7 > now, strictly increasing,
 * start === first) and sees nothing wrong; the amounts, by contrast, go
 * through BigInt() and a fraction there throws.
 *
 * No path in the current form produces such a time (vestingRows works in
 * whole minutes), so this is a gap of the shared gate, not of the shipped
 * form: low. The gate is documented as what both the form and the builder
 * refuse, and the devnet scripts and any later caller build entries by hand.
 *
 * Correct behaviour, asserted here: a tranche time that is not a safe
 * integer is refused by vestingProblem and by buildProposeVestings, like a
 * tranche of nothing is.
 */
import {
  buildProposeVestings,
  decodeCreateBatchArgs,
  encodeCreateBatchArgs,
  NewVesting,
  trancheSchedule,
  VestingFacts,
  VestingPin,
  vestingProblem
} from 'multisig/vesting';

// A v4 copy of mvxvest on devnet and the rehearsal safe, as the shipped tests use.
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const COPY = 'erd1qqqqqqqqqqqqqpgq47urq5rmd2x54tp638hejcm5uyn9t6ymaujqqxf98a';
const WALLET = 'erd1vsfzda20hmvjc7f7mymvyff5gusql04yug2ehtchrdalj2dad85q3685a5';
const PROPOSER =
  'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const TOKEN = 'TSAFED-e52b18';
const UNIT = 10n ** 18n;
const DAY = 86400;
const FIRST = 1793961456;

const pin: VestingPin = {
  address: COPY,
  codeHashes: [V4],
  claimKey: 'VESTKEY-2a3443',
  cancelKey: 'VESTCANCEL-2affd9'
};
const facts: VestingFacts = {
  codeHash: V4,
  creationPaused: false,
  claimKeyIssued: true,
  cancelKeyIssued: true,
  fee: 0n,
  tokenFeeBps: 0,
  safePayableBySc: true,
  safeBalance: 1000n * UNIT,
  safeEgld: UNIT
};
const context = { chainId: 'D', sender: PROPOSER, nonce: 7, safe: SAFE };

const batch = (entries: NewVesting[]) => ({
  pin,
  facts,
  safe: SAFE,
  token: TOKEN,
  cancelable: false,
  label: 'grants',
  entries,
  now: FIRST - 600
});
const one = (times: number[]): NewVesting[] => [
  {
    beneficiary: WALLET,
    schedule: trancheSchedule(times.map((time) => ({ time, amount: UNIT })))
  }
];
const firstTimeOf = (entries: NewVesting[]) => {
  const decoded = decodeCreateBatchArgs(
    encodeCreateBatchArgs({ cancelable: false, label: 'grants', entries })
  );
  const curve = decoded.entries[0].schedule.curve;
  return curve.kind === 'tranches' ? curve.tranches[0].time : NaN;
};

describe('VBD-01: a tranche time that is not a whole number of seconds', () => {
  it('control: whole seconds pass and are encoded exactly', async () => {
    const entries = one([FIRST, FIRST + DAY]);
    expect(vestingProblem(batch(entries))).toBe('');
    expect(firstTimeOf(entries)).toBe(FIRST);
    const transaction = await buildProposeVestings(context, batch(entries));
    expect(transaction.receiver.toBech32()).toBe(SAFE);
  });

  it('evidence: sdk-core encodes a fractional time as a different time', () => {
    const encoded = firstTimeOf(one([FIRST + 0.7, FIRST + DAY]));
    expect(encoded).not.toBe(FIRST + 0.7);
    // What it is today: 23 July 1973, long past, so the tranche vests at once.
    expect(encoded).toBeLessThan(FIRST);
  });

  it('is refused by vestingProblem, in the first tranche', () => {
    expect(vestingProblem(batch(one([FIRST + 0.7, FIRST + DAY])))).not.toBe('');
  });

  it('is refused by vestingProblem, in a later tranche', () => {
    expect(vestingProblem(batch(one([FIRST, FIRST + DAY + 0.5])))).not.toBe('');
  });

  it('is refused by the builder', async () => {
    await expect(
      buildProposeVestings(context, batch(one([FIRST + 0.7, FIRST + DAY])))
    ).rejects.toThrow();
  });
});
