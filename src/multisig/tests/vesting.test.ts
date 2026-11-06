/**
 * @jest-environment node
 */
// Vestings from a safe (6 Nov 2026): a safe creates mvxvest vestings as the
// caller, so it holds the cancel keys, and cancels with them. Proven on devnet
// first (docs/vestings-from-a-safe.md): the proposals the probe sent are rebuilt here byte for
// byte, and every refusal that keeps a vesting from failing after its
// signatures, or from going anywhere but the pinned contract, is held here.
import { Address } from '@multiversx/sdk-core';
import { MAX_GAS, performBudget } from 'multisig/gas';
import { buildProposeCall, MAX_ARGUMENT_BYTES } from 'multisig/legacyCalls';
import {
  buildProposeCancelVesting,
  buildProposeVestings,
  CANCEL_GAS_NEED,
  decodeCreateBatchArgs,
  encodeCreateBatchArgs,
  mvxvestFor,
  NewVesting,
  readVestingCall,
  trancheSchedule,
  VESTING_LIMITS,
  VestingFacts,
  vestingGasNeed,
  vestingPayment,
  VestingPin,
  vestingProblem
} from 'multisig/vesting';
import fixtures from './fixtures/vesting-devnet.json';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const utf8 = (bytes: Uint8Array) => Buffer.from(bytes).toString();
const dataOf = (transaction: { data: Uint8Array }) =>
  Buffer.from(transaction.data).toString();

// The devnet probe's layout: the rehearsal safe and our first v4 copy.
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const COPY = 'erd1qqqqqqqqqqqqqpgq47urq5rmd2x54tp638hejcm5uyn9t6ymaujqqxf98a';
const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const ERIN = 'erd1vsfzda20hmvjc7f7mymvyff5gusql04yug2ehtchrdalj2dad85q3685a5';
const FRANK = 'erd15ugay3nmrezmar6fx84s7n8rqf9s5vne0yrqtrcgtlacyy3rmg8skz0fqn';
const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const TOKEN = 'TSAFED-e52b18';
const UNIT = 10n ** 18n;
const DAY = 86400;

const pin: VestingPin = {
  address: COPY,
  codeHashes: [V4],
  claimKey: 'VESTKEY-2a3443',
  cancelKey: 'VESTCANCEL-2affd9'
};
const context = { chainId: 'D', sender: ALICE, nonce: 7, safe: SAFE };
const facts = (over: Partial<VestingFacts> = {}): VestingFacts => ({
  codeHash: V4,
  creationPaused: false,
  cancelKeyIssued: true,
  claimKeyIssued: true,
  fee: 0n,
  tokenFeeBps: 0,
  safePayableBySc: true,
  safeBalance: 1000n * UNIT,
  safeEgld: UNIT,
  ...over
});

// The probe's first batch (#28), as typed into the form.
const FIRST = 1793961456;
const probeEntries: NewVesting[] = [
  {
    beneficiary: ERIN,
    schedule: trancheSchedule([
      { time: FIRST, amount: 4n * UNIT },
      { time: FIRST + 2 * DAY, amount: 6n * UNIT }
    ])
  },
  {
    beneficiary: FRANK,
    schedule: trancheSchedule([
      { time: FIRST, amount: 2n * UNIT },
      { time: FIRST + 3 * DAY, amount: 4n * UNIT }
    ])
  }
];
const BEFORE = FIRST - 600;
const probe = {
  pin,
  facts: facts(),
  token: TOKEN,
  cancelable: true,
  label: 'mvxsafe probe',
  entries: probeEntries,
  now: BEFORE
};

describe('the devnet proposals, rebuilt byte for byte', () => {
  it('a batch of two cancelable vestings, fees zero: ESDTTransfer then createBatch, to mvxvest (#28)', async () => {
    const transaction = await buildProposeVestings(context, probe);
    expect(dataOf(transaction)).toBe(fixtures.create.data);
    expect(transaction.receiver.toBech32()).toBe(SAFE);
  });

  it('a cancel: ESDTNFTTransfer of the key, sent to the safe itself, then cancel on mvxvest (#29)', async () => {
    const transaction = await buildProposeCancelVesting(context, {
      pin,
      facts: facts(),
      collection: 'VESTCANCEL-2affd9',
      nonce: 1
    });
    expect(dataOf(transaction)).toBe(fixtures.cancel.data);
  });

  it('a batch paying both fees: token and EGLD in one MultiESDTNFTTransfer, sent to the safe itself (#30)', async () => {
    const first = 1793962092;
    const transaction = await buildProposeVestings(context, {
      ...probe,
      facts: facts({ fee: 10n ** 15n, tokenFeeBps: 10 }),
      label: 'mvxsafe probe, fees paid',
      entries: [
        {
          beneficiary: ERIN,
          schedule: trancheSchedule([
            { time: first, amount: UNIT },
            { time: first + DAY, amount: UNIT }
          ])
        }
      ],
      now: first - 600
    });
    expect(dataOf(transaction)).toBe(fixtures.createWithFees.data);
  });
});

describe('the createBatch arguments against the mvxvest ABI', () => {
  it('decode back to what was encoded', () => {
    const encoded = encodeCreateBatchArgs({
      cancelable: true,
      label: 'Grants, 4 years',
      entries: probeEntries
    });
    const decoded = decodeCreateBatchArgs(encoded);
    expect(decoded.cancelable).toBe(true);
    expect(decoded.label).toBe('Grants, 4 years');
    expect(decoded.entries).toEqual([
      {
        beneficiary: ERIN,
        total: 10n * UNIT,
        schedule: probeEntries[0].schedule
      },
      {
        beneficiary: FRANK,
        total: 6n * UNIT,
        schedule: probeEntries[1].schedule
      }
    ]);
  });

  it('a linear and a stepped schedule decode too, as a card must read whatever was proposed', () => {
    const linear = {
      start: 100,
      cliff: 200,
      cliffAmount: 5n,
      end: 1000,
      curve: { kind: 'linear' as const }
    };
    const stepped = {
      start: 100,
      cliff: 100,
      cliffAmount: 0n,
      end: 1000,
      curve: { kind: 'stepped' as const, interval: 300 }
    };
    const decoded = decodeCreateBatchArgs(
      encodeCreateBatchArgs({
        cancelable: false,
        label: '',
        entries: [
          { beneficiary: ERIN, schedule: linear, total: 50n },
          { beneficiary: FRANK, schedule: stepped, total: 9n }
        ]
      })
    );
    expect(decoded.entries.map((entry) => entry.schedule)).toEqual([
      linear,
      stepped
    ]);
  });

  it('arguments that are not a createBatch say so instead of throwing', () => {
    expect(decodeCreateBatchArgs([new Uint8Array([7])]).error).toMatch(
      /could not be read/
    );
  });
});

describe('what the safe pays', () => {
  it('the sum of the vestings, plus the token fee of each, plus the EGLD fee of each', () => {
    const payment = vestingPayment(
      [
        {
          beneficiary: ERIN,
          schedule: trancheSchedule([{ time: FIRST, amount: 999n }])
        },
        {
          beneficiary: FRANK,
          schedule: trancheSchedule([{ time: FIRST, amount: 1001n }])
        }
      ],
      { fee: 10n ** 17n, tokenFeeBps: 10 }
    );
    // Rounded down per vesting, as the contract does: 0 + 1, not 2.
    expect(payment).toEqual({
      sum: 2000n,
      tokenFee: 1n,
      egldFee: 2n * 10n ** 17n,
      tokenAmount: 2001n
    });
  });

  it('a token fee alone stays one ESDTTransfer, to mvxvest', async () => {
    const transaction = await buildProposeVestings(context, {
      ...probe,
      facts: facts({ tokenFeeBps: 10 })
    });
    const parts = dataOf(transaction).split('@');
    expect(Address.newFromHex(parts[1]).toBech32()).toBe(COPY);
    expect(utf8(Buffer.from(parts[3], 'hex'))).toBe('ESDTTransfer');
    expect(BigInt(`0x${parts[5]}`)).toBe(16n * UNIT + 16n * 10n ** 15n);
  });
});

describe('what is refused before anything is proposed', () => {
  const problem = (over: Record<string, any> = {}) =>
    vestingProblem({ ...probe, safe: SAFE, ...over });

  it('accepts the probe batch', () => {
    expect(problem()).toBe('');
  });

  it('a network with no mvxvest pinned', () => {
    expect(problem({ pin: null })).toMatch(/no mvxvest on this network/);
  });

  it('a contract whose code is not an accepted mvxvest release', () => {
    expect(problem({ facts: facts({ codeHash: 'ab'.repeat(32) }) })).toMatch(
      /not a release of mvxvest/
    );
    expect(problem({ facts: facts({ codeHash: null }) })).toMatch(
      /not a release of mvxvest/
    );
  });

  it('creation paused, or a key collection not issued', () => {
    expect(problem({ facts: facts({ creationPaused: true }) })).toMatch(
      /paused/
    );
    expect(problem({ facts: facts({ cancelKeyIssued: false }) })).toMatch(
      /cancel keys/
    );
    expect(problem({ facts: facts({ claimKeyIssued: false }) })).toMatch(
      /claim keys/
    );
  });

  it('a safe that cannot receive the keys from a contract', () => {
    expect(problem({ facts: facts({ safePayableBySc: false }) })).toMatch(
      /payable by smart contracts/
    );
  });

  it('more vestings than one transaction holds: 32 when cancelable, 49 when not', () => {
    const many = (count: number) =>
      Array.from({ length: count }, () => ({
        beneficiary: ERIN,
        schedule: trancheSchedule([{ time: FIRST, amount: 1n }])
      }));
    expect(problem({ entries: many(33) })).toMatch(/at most 32/);
    expect(problem({ entries: many(32) })).toBe('');
    expect(problem({ cancelable: false, entries: many(50) })).toMatch(
      /at most 49/
    );
    expect(problem({ entries: [] })).toMatch(/at least one/);
  });

  it('a tranche date that has passed, or dates out of order', () => {
    expect(problem({ now: FIRST + 1 })).toMatch(/in the past/);
    const out = [
      {
        beneficiary: ERIN,
        schedule: trancheSchedule([
          { time: FIRST + DAY, amount: 1n },
          { time: FIRST, amount: 1n }
        ])
      }
    ];
    expect(problem({ entries: out })).toMatch(/strictly later/);
    const same = [
      {
        beneficiary: ERIN,
        schedule: trancheSchedule([
          { time: FIRST, amount: 1n },
          { time: FIRST, amount: 1n }
        ])
      }
    ];
    expect(problem({ entries: same })).toMatch(/strictly later/);
  });

  it('a schedule that ends more than 30 years ahead, or has too many tranches', () => {
    const far = [
      {
        beneficiary: ERIN,
        schedule: trancheSchedule([
          { time: BEFORE + 31 * 365 * DAY, amount: 1n }
        ])
      }
    ];
    expect(problem({ entries: far })).toMatch(/30 years/);
    const tranches = Array.from(
      { length: VESTING_LIMITS.tranches + 1 },
      (_, at) => ({ time: FIRST + at, amount: 1n })
    );
    expect(
      problem({
        entries: [{ beneficiary: ERIN, schedule: trancheSchedule(tranches) }]
      })
    ).toMatch(/at most 120 tranches/);
  });

  it('a tranche of nothing', () => {
    const zero = [
      {
        beneficiary: ERIN,
        schedule: trancheSchedule([{ time: FIRST, amount: 0n }])
      }
    ];
    expect(problem({ entries: zero })).toMatch(/more than zero/);
  });

  it('a beneficiary that is the safe itself, mvxvest, or not an address', () => {
    expect(
      problem({ entries: [{ ...probeEntries[0], beneficiary: SAFE }] })
    ).toMatch(/the safe itself/);
    expect(
      problem({ entries: [{ ...probeEntries[0], beneficiary: COPY }] })
    ).toMatch(/mvxvest itself/);
    expect(
      problem({
        entries: [{ ...probeEntries[0], beneficiary: `${ERIN.slice(0, -1)}x` }]
      })
    ).toMatch(/not a valid MultiversX/);
  });

  it('a label longer than 64 bytes', () => {
    expect(problem({ label: 'é'.repeat(33) })).toMatch(/64 bytes/);
    expect(problem({ label: 'x'.repeat(64) })).toBe('');
  });

  it('EGLD, or anything that is not a fungible token identifier', () => {
    expect(problem({ token: 'EGLD' })).toMatch(/a token, not EGLD/);
    expect(problem({ token: 'EGLD-000000' })).toMatch(/a token, not EGLD/);
    expect(problem({ token: 'VESTCANCEL-2affd9-01' })).toMatch(
      /not a token identifier/
    );
  });

  it('more than the safe holds, of the token or of the EGLD for the fee', () => {
    expect(problem({ facts: facts({ safeBalance: 16n * UNIT - 1n }) })).toMatch(
      /holds only/
    );
    // In the token's own units when its decimals are known, as the form knows them.
    expect(
      problem({ decimals: 18, facts: facts({ safeBalance: 15n * UNIT }) })
    ).toMatch(/needs 16 TSAFED-e52b18; the safe holds only 15\./);
    expect(
      problem({ facts: facts({ fee: 10n ** 17n, safeEgld: 10n ** 17n }) })
    ).toMatch(/0\.2 EGLD/);
    expect(problem({ facts: facts({ safeBalance: 16n * UNIT }) })).toBe('');
    expect(
      problem({ facts: facts({ fee: 10n ** 17n, safeEgld: 10n ** 17n }) })
    ).toMatch(/EGLD for the fee/);
  });

  it('a batch whose arguments the safe could not return, however few vestings', () => {
    const tranches = Array.from({ length: 100 }, (_, at) => ({
      time: FIRST + at * DAY,
      amount: 10n ** 24n
    }));
    const big = Array.from({ length: 4 }, () => ({
      beneficiary: ERIN,
      schedule: trancheSchedule(tranches)
    }));
    expect(
      problem({ entries: big, facts: facts({ safeBalance: 10n ** 30n }) })
    ).toMatch(new RegExp(MAX_ARGUMENT_BYTES.toLocaleString('en-US')));
  });

  it('the builder refuses what the form refuses', async () => {
    await expect(
      buildProposeVestings(context, {
        ...probe,
        pin: { ...pin, address: ERIN }
      })
    ).rejects.toThrow(/not a contract/);
    await expect(
      buildProposeVestings(context, { ...probe, now: FIRST + 1 })
    ).rejects.toThrow(/in the past/);
    await expect(
      buildProposeVestings(context, {
        ...probe,
        facts: facts({ codeHash: 'ab'.repeat(32) })
      })
    ).rejects.toThrow(/not a release of mvxvest/);
  });
});

describe('a cancel', () => {
  const cancel = (over: Record<string, any> = {}) =>
    buildProposeCancelVesting(context, {
      pin,
      facts: facts(),
      collection: 'VESTCANCEL-2affd9',
      nonce: 1,
      ...over
    });

  it('goes to the safe itself, which sends the key on to the pinned mvxvest with cancel()', async () => {
    const parts = dataOf(await cancel({ nonce: 300 })).split('@');
    expect(Address.newFromHex(parts[1]).toBech32()).toBe(SAFE);
    expect(utf8(Buffer.from(parts[3], 'hex'))).toBe('ESDTNFTTransfer');
    expect(parts[5]).toBe('012c');
    expect(Address.newFromHex(parts[7]).toBech32()).toBe(COPY);
    expect(utf8(Buffer.from(parts[8], 'hex'))).toBe('cancel');
  });

  it('refuses another collection, a key number of 0, another contract or code', async () => {
    await expect(cancel({ collection: 'VESTKEY-2a3443' })).rejects.toThrow(
      /cancel key/
    );
    await expect(cancel({ nonce: 0 })).rejects.toThrow(/key number/);
    await expect(
      cancel({ facts: facts({ codeHash: 'ab'.repeat(32) }) })
    ).rejects.toThrow(/not a release of mvxvest/);
    await expect(cancel({ pin: null })).rejects.toThrow(
      /no mvxvest on this network/
    );
  });
});

describe('the generic call form keeps refusing every token transfer', () => {
  it.each(['ESDTTransfer', 'ESDTNFTTransfer', 'MultiESDTNFTTransfer'])(
    '%s',
    async (name) => {
      await expect(
        buildProposeCall(context, { to: COPY, functionName: name, args: [] })
      ).rejects.toThrow(/built-in/);
    }
  );
});

describe('reading a pending action back', () => {
  const callOf = (transaction: { data: Uint8Array }) => {
    const parts = dataOf(transaction).split('@');
    return {
      to: Address.newFromHex(parts[1]).toBech32(),
      egld: 0n,
      endpoint: utf8(Buffer.from(parts[3], 'hex')),
      args: parts
        .slice(4)
        .map((part) => Uint8Array.from(Buffer.from(part, 'hex'))),
      safe: SAFE
    };
  };

  it('a batch: the contract, what is paid, and every vesting', async () => {
    const read = readVestingCall(
      callOf(await buildProposeVestings(context, probe))
    );
    expect(read).toMatchObject({
      kind: 'create',
      contract: COPY,
      payments: [{ token: TOKEN, nonce: 0n, amount: 16n * UNIT }],
      batch: { cancelable: true, label: 'mvxsafe probe' }
    });
    expect(
      read?.kind === 'create' &&
        'entries' in read.batch &&
        read.batch.entries.map((entry) => entry.beneficiary)
    ).toEqual([ERIN, FRANK]);
  });

  it('a batch paying fees: both payments', async () => {
    const read = readVestingCall(
      callOf(
        await buildProposeVestings(context, {
          ...probe,
          facts: facts({ fee: 5n, tokenFeeBps: 10 })
        })
      )
    );
    expect(read).toMatchObject({
      kind: 'create',
      contract: COPY,
      payments: [
        { token: TOKEN, nonce: 0n, amount: 16n * UNIT + 16n * 10n ** 15n },
        { token: 'EGLD-000000', nonce: 0n, amount: 10n }
      ]
    });
  });

  it('a cancel: the contract and the key', async () => {
    const read = readVestingCall(
      callOf(
        await buildProposeCancelVesting(context, {
          pin,
          facts: facts(),
          collection: 'VESTCANCEL-2affd9',
          nonce: 2
        })
      )
    );
    expect(read).toEqual({
      kind: 'cancel',
      contract: COPY,
      keys: [{ token: 'VESTCANCEL-2affd9', nonce: 2n, amount: 1n }]
    });
  });

  it('a createBatch to some other contract is still read, so the card can say it is not mvxvest', () => {
    const read = readVestingCall({
      ...callOf({ data: Buffer.from(fixtures.create.data) }),
      to: ERIN
    });
    expect(read).toMatchObject({ kind: 'create', contract: ERIN });
  });

  it('a plain token transfer, or any other call, is not a vesting', () => {
    const plain = {
      to: ERIN,
      egld: 0n,
      endpoint: 'ESDTTransfer',
      args: [Buffer.from(TOKEN), Uint8Array.from([1])],
      safe: SAFE
    };
    expect(readVestingCall(plain)).toBeNull();
    expect(
      readVestingCall({ ...plain, endpoint: 'setFee', args: [] })
    ).toBeNull();
    expect(
      readVestingCall({ ...plain, args: [...plain.args, Buffer.from('swap')] })
    ).toBeNull();
  });
});

describe('the gas a vesting is given', () => {
  // Measured on devnet, 6 Nov 2026 (scripts/devnet/vest-gas.mjs): [vestings,
  // tranches each, cancelable, fees paid, need]. A fresh copy of mvxvest v4
  // with zero fees, 10-byte tranche amounts and a 64-byte label first, then the
  // pinned devnet mvxvest (its keys' display set, fees on, 8-byte amounts),
  // then what a real carry-out there used (action #33).
  const MEASURED: [number, number, boolean, boolean, number][] = [
    [1, 1, true, false, 13_288_502],
    [1, 8, true, false, 16_215_517],
    [2, 8, true, false, 26_900_242],
    [8, 8, true, false, 91_295_710],
    [16, 8, true, false, 177_725_254],
    [24, 8, true, false, 264_487_598],
    [32, 1, true, false, 257_918_262],
    [32, 4, true, false, 295_871_382],
    [12, 12, true, false, 157_549_442],
    [1, 1, false, false, 11_104_329],
    [8, 8, false, false, 74_740_419],
    [24, 8, false, false, 214_746_131],
    [32, 4, false, false, 229_536_827],
    [12, 12, false, false, 132_697_607],
    [1, 1, true, true, 17_103_442],
    [2, 2, true, true, 27_706_366],
    [2, 8, true, true, 32_427_706],
    [4, 8, true, true, 57_615_524],
    [5, 8, true, true, 70_215_733],
    [1, 24, true, true, 28_078_027],
    [5, 1, true, true, 56_631_158],
    [1, 1, false, true, 13_733_031],
    [2, 2, false, true, 21_262_785],
    [5, 8, false, true, 54_484_512],
    [1, 24, false, true, 24_707_616],
    [5, 1, false, true, 40_899_937],
    [2, 2, true, true, 25_076_346]
  ];
  const batch = (count: number, tranches: number) =>
    Array.from({ length: count }, () => ({
      beneficiary: ERIN,
      schedule: trancheSchedule(
        Array.from({ length: tranches }, (_, at) => ({
          time: FIRST + at,
          amount: 10n ** 24n
        }))
      )
    }));

  it.each(MEASURED)(
    '%i vestings of %i tranches, cancelable %s, fees %s: never less than devnet measured',
    (count, tranches, cancelable, feesPaid, measured) => {
      expect(
        Number(
          vestingGasNeed({
            entries: batch(count, tranches),
            cancelable,
            feesPaid
          })
        )
      ).toBeGreaterThanOrEqual(measured);
    }
  );

  it('fees add more than devnet measured them to cost on a copy, 1.2M', () => {
    const entries = batch(8, 8);
    expect(
      vestingGasNeed({ entries, cancelable: true, feesPaid: true }) -
        vestingGasNeed({ entries, cancelable: true, feesPaid: false })
    ).toBeGreaterThanOrEqual(1_200_000n);
  });

  it('the largest batch the size cap allows still fits in one transaction', () => {
    const rich = facts({ safeBalance: 10n ** 30n });
    for (const tranches of [1, 4, 8, 12, 24]) {
      let count = VESTING_LIMITS.batchCancelable;
      while (
        count > 0 &&
        vestingProblem({
          ...probe,
          safe: SAFE,
          facts: rich,
          entries: batch(count, tranches)
        }) !== ''
      )
        count--;
      expect(count).toBeGreaterThan(0);
      expect(
        performBudget(
          vestingGasNeed({
            entries: batch(count, tranches),
            cancelable: true,
            feesPaid: true
          })
        )
      ).toBeLessThan(MAX_GAS);
    }
    // Eight half-yearly tranches of a 10-byte amount: about 30 people a batch.
    let count = VESTING_LIMITS.batchCancelable;
    while (
      vestingProblem({
        ...probe,
        safe: SAFE,
        facts: rich,
        entries: batch(count, 8)
      }) !== ''
    )
      count--;
    expect(count).toBeGreaterThanOrEqual(24);
  });

  it('a cancel of one key: more than the 6.3M devnet measured as the safe', () => {
    expect(CANCEL_GAS_NEED).toBeGreaterThan(6_324_049n);
  });
});

describe('the pinned contracts', () => {
  it('mainnet and devnet name mvxvest version 4; testnet has none', () => {
    expect(mvxvestFor('mainnet')).toEqual({
      address: 'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu',
      codeHashes: [V4],
      claimKey: 'VESTKEY-f56bea',
      cancelKey: 'VESTCANCEL-ae94f5'
    });
    expect(mvxvestFor('devnet')).toEqual({
      address: 'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp',
      codeHashes: [V4],
      claimKey: 'VESTKEY-8f217c',
      cancelKey: 'VESTCANCEL-bd731d'
    });
    expect(mvxvestFor('testnet')).toBeNull();
  });
});

// Keep the helpers honest: they are what the card and the form show.
it('hex helpers', () => {
  expect(hex(Uint8Array.from([1, 255]))).toBe('01ff');
});
