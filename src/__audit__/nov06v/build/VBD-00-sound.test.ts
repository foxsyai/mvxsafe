/**
 * @jest-environment node
 *
 * VBD-00: what was checked in the build area on 6 Nov 2026 and held. Every
 * case here passes on the code under audit; they are the controls of the
 * report's "checked and sound", kept runnable.
 *
 *  1. The pin against the chain as read that day (recorded here, nothing is
 *     fetched): both networks' mvxvest run the code whose blake2b is V4, report
 *     the pinned collections, and their getLimits are the builder's limits.
 *  2. The payment against mvxvest's settle_payment and token_fee_of
 *     (create.rs), ported here and run over random batches: rounding per
 *     vesting, the EGLD fee per vesting, one token.
 *  3. The arguments against mvxvest's Schedule::validate and create_one
 *     (schedule.rs, create.rs), ported here: whatever vestingProblem lets
 *     through, encoded and decoded back through the ABI, passes those checks
 *     at any later block time within the horizon.
 *  4. The two shapes of the call: one ESDTTransfer to mvxvest while the EGLD
 *     fee is zero, a MultiESDTNFTTransfer to the safe itself with the token
 *     first and EGLD-000000 second, both at nonce 0, when it is not.
 *  5. signOnly still pins a vesting proposal as built: a wallet that returns
 *     other data, another receiver or less gas gets nothing sent.
 */
jest.mock('lib', () => {
  const core = jest.requireActual('@multiversx/sdk-core');
  return {
    Transaction: core.Transaction,
    TransactionComputer: core.TransactionComputer,
    TransactionManager: { getInstance: () => ({}) },
    getLatestNonce: () => 0,
    getAccountProvider: () => wallet.provider
  };
});
jest.mock(
  '@multiversx/sdk-dapp/out/store/actions/account/accountActions',
  () => ({ setAccountNonce: jest.fn() })
);
jest.mock('multisig/network', () => ({ api: async () => ({}), chainId: 'D' }));

import { Address, Transaction } from '@multiversx/sdk-core';
import { signOnly } from 'helpers/signAndSendTransactions';
import {
  buildProposeVestings,
  decodeCreateBatchArgs,
  encodeCreateBatchArgs,
  entryTotal,
  mvxvestFor,
  NewVesting,
  trancheSchedule,
  VESTING_LIMITS,
  VestingFacts,
  vestingPayment,
  VestingPin,
  vestingProblem
} from 'multisig/vesting';

const wallet: {
  provider: { signTransactions: (t: Transaction[]) => Promise<Transaction[]> };
} = {
  provider: { signTransactions: async (transactions) => transactions }
};

const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const COPY = 'erd1qqqqqqqqqqqqqpgq47urq5rmd2x54tp638hejcm5uyn9t6ymaujqqxf98a';
const WALLET = 'erd1vsfzda20hmvjc7f7mymvyff5gusql04yug2ehtchrdalj2dad85q3685a5';
const OTHER = 'erd15ugay3nmrezmar6fx84s7n8rqf9s5vne0yrqtrcgtlacyy3rmg8skz0fqn';
const PROPOSER =
  'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const TOKEN = 'TSAFED-e52b18';
const UNIT = 10n ** 18n;
const FIRST = 1793961456;
const NOW = FIRST - 600;

const pin: VestingPin = {
  address: COPY,
  codeHashes: [V4],
  claimKey: 'VESTKEY-2a3443',
  cancelKey: 'VESTCANCEL-2affd9'
};
const facts = (over: Partial<VestingFacts> = {}): VestingFacts => ({
  codeHash: V4,
  creationPaused: false,
  claimKeyIssued: true,
  cancelKeyIssued: true,
  fee: 0n,
  tokenFeeBps: 0,
  safePayableBySc: true,
  safeBalance: 10n ** 30n,
  safeEgld: 10n ** 21n,
  ...over
});
const context = { chainId: 'D', sender: PROPOSER, nonce: 7, safe: SAFE };

// A small deterministic generator, so a failure is reproducible.
let seed = 20261106;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (n: number) => Math.floor(random() * n);
const randomBatch = (): NewVesting[] =>
  Array.from({ length: 1 + pick(6) }, () => {
    const count = 1 + pick(12);
    let time = FIRST + pick(86400 * 30);
    return {
      beneficiary: random() < 0.5 ? WALLET : OTHER,
      schedule: trancheSchedule(
        Array.from({ length: count }, () => {
          const tranche = {
            time,
            amount: BigInt(1 + pick(1000)) * 10n ** BigInt(pick(19))
          };
          time += 1 + pick(86400 * 200);
          return tranche;
        })
      )
    };
  });

// --- 1. the pin, as read on 6 Nov 2026 ---------------------------------------

describe('the pin against the chain as read on 6 Nov 2026', () => {
  // blake2b-256 of the code field of /accounts/<mvxvest>, 29,464 bytes on both networks.
  const READ = {
    mainnet: {
      code: '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246',
      claim: 'VESTKEY-f56bea',
      cancel: 'VESTCANCEL-ae94f5'
    },
    devnet: {
      code: '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246',
      claim: 'VESTKEY-8f217c',
      cancel: 'VESTCANCEL-bd731d'
    }
  };
  // getLimits on both: six u64, 8 bytes each.
  const LIMITS =
    '000000000000007800000000000000310000000000000020000000000000004000000000386409000000000000000064';

  it.each(['mainnet', 'devnet'] as const)('%s: code, collections', (net) => {
    const pinned = mvxvestFor(net)!;
    expect(pinned.codeHashes).toContain(READ[net].code);
    expect(pinned.claimKey).toBe(READ[net].claim);
    expect(pinned.cancelKey).toBe(READ[net].cancel);
  });

  it('getLimits: tranches, batch, cancelable batch, label, horizon', () => {
    const limits = LIMITS.match(/.{16}/g)!.map((part) => parseInt(part, 16));
    expect(limits.slice(0, 5)).toEqual([
      VESTING_LIMITS.tranches,
      // mvxvest's own 49; mvxsafe proposes at most 48 since the fix of this
      // audit (VESTING_LIMITS.batch), for the network's 100 built-in calls.
      VESTING_LIMITS.contractBatch,
      VESTING_LIMITS.batchCancelable,
      VESTING_LIMITS.labelBytes,
      VESTING_LIMITS.horizonSeconds
    ]);
  });
});

// --- 2. the payment against create.rs ----------------------------------------

/** settle_payment and token_fee_of, as create.rs computes them for a batch. */
const mvxvestWants = (totals: bigint[], feePerVesting: bigint, bps: bigint) => {
  let sum = 0n;
  let tokenFee = 0n;
  for (const total of totals) {
    sum += total;
    tokenFee += bps === 0n ? 0n : (total * bps) / 10000n;
  }
  return { token: sum + tokenFee, egld: feePerVesting * BigInt(totals.length) };
};

describe('the payment against mvxvest', () => {
  it('equals what settle_payment requires, for 300 random batches and fees', () => {
    for (let round = 0; round < 300; round++) {
      const entries = randomBatch();
      const fee = random() < 0.3 ? 0n : BigInt(pick(10 ** 18));
      const bps = random() < 0.3 ? 0 : pick(201);
      const payment = vestingPayment(entries, { fee, tokenFeeBps: bps });
      const wants = mvxvestWants(entries.map(entryTotal), fee, BigInt(bps));
      expect(payment.tokenAmount).toBe(wants.token);
      expect(payment.egldFee).toBe(wants.egld);
    }
  });
});

// --- 3. the arguments against schedule.rs and create.rs -----------------------

/** Schedule::validate and create_one's own checks, for a tranche schedule. */
const createOneAccepts = (
  entry: { beneficiary: string; total: bigint; schedule: any },
  blockTime: number,
  label: string
) => {
  const { schedule, total } = entry;
  if (total === 0n) return 'total must be more than zero';
  if (schedule.start > schedule.cliff || schedule.cliff > schedule.end)
    return 'times must be start <= cliff <= end';
  if (schedule.cliffAmount > total) return 'cliff amount above total';
  if (schedule.curve.kind !== 'tranches') return 'not a tranche schedule';
  const tranches = schedule.curve.tranches as {
    time: number;
    amount: bigint;
  }[];
  if (tranches.length === 0 || tranches.length > 120)
    return 'tranche count out of range';
  let previous: number | null = null;
  let sum = 0n;
  for (const tranche of tranches) {
    if (tranche.amount === 0n) return 'tranche amount must be more than zero';
    if (tranche.time < schedule.start) return 'tranche before start';
    if (previous !== null && tranche.time <= previous)
      return 'tranche times must strictly increase';
    previous = tranche.time;
    sum += tranche.amount;
  }
  if (previous !== schedule.end) return 'last tranche must be at the end';
  if (sum + schedule.cliffAmount !== total)
    return 'tranches plus cliff amount must equal the total';
  const bytes = new TextEncoder().encode(label).length;
  if (bytes > 64) return 'label too long';
  if (schedule.end > blockTime + VESTING_LIMITS.horizonSeconds)
    return 'schedule ends too far in the future';
  const key = Address.newFromBech32(entry.beneficiary).getPublicKey();
  if (key.every((byte) => byte === 0) || entry.beneficiary === COPY)
    return 'beneficiary cannot be the zero address or this contract';
  return '';
};

describe('what vestingProblem lets through, mvxvest accepts', () => {
  it('200 random batches, decoded back through the ABI, at the proposal time and a year later', () => {
    let accepted = 0;
    for (let round = 0; round < 200; round++) {
      const entries = randomBatch();
      const label = 'x'.repeat(pick(65));
      const cancelable = random() < 0.5;
      const problem = vestingProblem({
        pin,
        facts: facts(),
        safe: SAFE,
        token: TOKEN,
        cancelable,
        label,
        entries,
        now: NOW
      });
      if (problem) continue;
      accepted++;
      const decoded = decodeCreateBatchArgs(
        encodeCreateBatchArgs({ cancelable, label, entries })
      );
      expect(decoded.error).toBeUndefined();
      expect(decoded.entries.length).toBeLessThanOrEqual(
        cancelable ? VESTING_LIMITS.batchCancelable : VESTING_LIMITS.batch
      );
      for (const [at, entry] of decoded.entries.entries()) {
        expect(entry.schedule).toEqual(entries[at].schedule);
        expect(entry.total).toBe(entryTotal(entries[at]));
        for (const blockTime of [NOW, NOW + 3600, NOW + 365 * 86400])
          expect(createOneAccepts(entry, blockTime, label)).toBe('');
      }
    }
    expect(accepted).toBeGreaterThan(100);
  });
});

// --- 4. the two shapes of the call --------------------------------------------

const partsOf = (transaction: Transaction) =>
  Buffer.from(transaction.data).toString().split('@');
const text = (hex: string) => Buffer.from(hex, 'hex').toString();

describe('the shape of the call', () => {
  const entries = randomBatch();
  const input = {
    pin,
    token: TOKEN,
    cancelable: true,
    label: 'grants',
    entries,
    now: NOW
  };

  it('EGLD fee zero: ESDTTransfer of the sum plus the token fee, to mvxvest, then createBatch', async () => {
    const parts = partsOf(
      await buildProposeVestings(context, {
        ...input,
        facts: facts({ tokenFeeBps: 25 })
      })
    );
    const wants = mvxvestWants(entries.map(entryTotal), 0n, 25n);
    expect(Address.newFromHex(parts[1]).toBech32()).toBe(COPY);
    expect(parts[2]).toBe('');
    expect(text(parts[3])).toBe('ESDTTransfer');
    expect(text(parts[4])).toBe(TOKEN);
    expect(BigInt(`0x${parts[5]}`)).toBe(wants.token);
    expect(text(parts[6])).toBe('createBatch');
  });

  it('EGLD fee above zero: MultiESDTNFTTransfer to the safe itself, the token then EGLD-000000, both nonce 0', async () => {
    const fee = 10n ** 17n;
    const parts = partsOf(
      await buildProposeVestings(context, {
        ...input,
        facts: facts({ fee, tokenFeeBps: 10 })
      })
    );
    const wants = mvxvestWants(entries.map(entryTotal), fee, 10n);
    expect(Address.newFromHex(parts[1]).toBech32()).toBe(SAFE);
    expect(parts[2]).toBe('');
    expect(text(parts[3])).toBe('MultiESDTNFTTransfer');
    expect(Address.newFromHex(parts[4]).toBech32()).toBe(COPY);
    expect(parts[5]).toBe('02');
    expect(text(parts[6])).toBe(TOKEN);
    expect(parts[7]).toBe('');
    expect(BigInt(`0x${parts[8]}`)).toBe(wants.token);
    expect(text(parts[9])).toBe('EGLD-000000');
    expect(parts[10]).toBe('');
    expect(BigInt(`0x${parts[11]}`)).toBe(wants.egld);
    expect(text(parts[12])).toBe('createBatch');
  });
});

// --- 5. signOnly ---------------------------------------------------------------

describe('signOnly pins a vesting proposal as built', () => {
  const build = (beneficiary = WALLET) =>
    buildProposeVestings(context, {
      pin,
      facts: facts(),
      token: TOKEN,
      cancelable: true,
      label: 'grants',
      entries: [
        {
          beneficiary,
          schedule: trancheSchedule([{ time: FIRST, amount: UNIT }])
        }
      ],
      now: NOW
    });

  it('control: what comes back as built is accepted', async () => {
    const transaction = await build();
    transaction.gasLimit = 30_000_000n;
    wallet.provider.signTransactions = async (list) => list;
    await expect(signOnly([transaction])).resolves.toHaveLength(1);
  });

  it('other data (another beneficiary): nothing is sent', async () => {
    const transaction = await build();
    transaction.gasLimit = 30_000_000n;
    const other = await build(OTHER);
    other.gasLimit = 30_000_000n;
    wallet.provider.signTransactions = async () => [other];
    await expect(signOnly([transaction])).rejects.toThrow(/its data differs/);
  });

  it('another receiver, or less gas: nothing is sent', async () => {
    const transaction = await build();
    transaction.gasLimit = 30_000_000n;
    wallet.provider.signTransactions = async ([built]) => [
      new Transaction({ ...built, receiver: Address.newFromBech32(OTHER) })
    ];
    await expect(signOnly([transaction])).rejects.toThrow(
      /its receiver differs/
    );
    wallet.provider.signTransactions = async ([built]) => [
      new Transaction({ ...built, gasLimit: 29_000_000n })
    ];
    await expect(signOnly([transaction])).rejects.toThrow(
      /its gas limit differs/
    );
  });
});
