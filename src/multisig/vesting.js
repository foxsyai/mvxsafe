// Vestings from a safe: the safe calls mvxvest itself, as the caller, so the
// cancel keys mvxvest sends back to its caller stay in the safe, and so does
// every refund a cancel pays (brief of 6 Nov 2026). Two narrow actions for one
// known contract, never a general "tokens plus any call": the call form keeps
// refusing every token transfer (UPG-01, SEE-01, TXN-04).
//
// Plain JavaScript, like legacyCalls.js: the devnet rehearsal imports this
// file, so what is proven there is literally what ships. Proven first on
// devnet with the probe's own encoding, in both layouts (6 Nov 2026,
// docs/vestings-from-a-safe.md): the safe in another shard than mvxvest, and
// in the same shard. The probe's proposals are rebuilt byte for byte in
// tests/vesting.test.ts.

import {
  Abi,
  Address,
  AddressValue,
  ArgSerializer,
  BigUIntValue,
  BytesValue,
  NativeSerializer,
  SmartContractTransactionsFactory,
  TransactionsFactoryConfig,
  VariadicValue
} from '@multiversx/sdk-core';
import mvxvestAbiJson from '../abi/mvxvest.abi.json' with { type: 'json' };
import { MAX_GAS, performBudget } from './gas.js';
import {
  legacyAbi,
  MAX_ARGUMENT_BYTES,
  parseAddress,
  topEncode
} from './legacyCalls.js';

/** mvxvest's ABI, version 4: its reproducible build, code hash 0e9ebff7. */
export const mvxvestAbi = Abi.create(mvxvestAbiJson);

const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';

/**
 * The one mvxvest each network may be called as, with the code it must run
 * and its two key collections, as mvxvest's own site pins them
 * (dapp/src/config). A vesting action names this address or it is refused,
 * and the card turns red for any other.
 */
const MVXVEST = {
  mainnet: {
    address: 'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu',
    codeHashes: [V4],
    claimKey: 'VESTKEY-f56bea',
    cancelKey: 'VESTCANCEL-ae94f5'
  },
  devnet: {
    address: 'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp',
    codeHashes: [V4],
    claimKey: 'VESTKEY-8f217c',
    cancelKey: 'VESTCANCEL-bd731d'
  }
};

/** The pinned mvxvest of a network, or null where there is none. */
export const mvxvestFor = (network) => MVXVEST[network] ?? null;

/**
 * mvxvest's own limits (contracts/vesting/src: create.rs, schedule.rs), and
 * the one mvxsafe keeps lower. mvxvest takes 49 vestings that cannot be
 * cancelled; each mints and sends a key, a built-in call each, and the network
 * allows 100 a transaction. From a safe in mvxvest's shard the safe's own
 * transfer counts too, so 49 with a token fee is exactly 100: mvxsafe proposes
 * at most 48 (audit of 6 Nov 2026). `contractBatch` is what mvxvest refuses.
 */
export const VESTING_LIMITS = {
  batch: 48,
  contractBatch: 49,
  batchCancelable: 32,
  tranches: 120,
  labelBytes: 64,
  horizonSeconds: 30 * 365 * 24 * 60 * 60
};

const TOKEN_ID = /^[A-Z0-9]{3,10}-[0-9a-f]{6}$/;
const EGLD_IN_TRANSFERS = 'EGLD-000000';
const CREATE_FUNCTIONS = new Set(['createBatch', 'create']);
const BPS = 10000n;

const utf8 = (text) => new TextEncoder().encode(text);
const textOf = (bytes) => new TextDecoder().decode(bytes ?? new Uint8Array(0));
const bigOf = (bytes) => {
  let value = 0n;
  for (const byte of bytes ?? []) value = value * 256n + BigInt(byte);
  return value;
};
const toBig = (value) =>
  BigInt(value?.toFixed ? value.toFixed() : String(value));
const toNum = (value) => Number(toBig(value));

// --- schedules ---------------------------------------------------------------

/**
 * A schedule of explicit releases, the case the board uses: each tranche
 * vests in full at its time. Starts, and has its cliff, at the first tranche,
 * with nothing at the cliff itself, and ends at the last, which mvxvest
 * requires (schedule.rs).
 */
export const trancheSchedule = (tranches) => {
  const list = tranches.map(({ time, amount }) => ({
    time: Number(time),
    amount: BigInt(amount)
  }));
  const first = list[0]?.time ?? 0;
  const last = list[list.length - 1]?.time ?? 0;
  return {
    start: first,
    cliff: first,
    cliffAmount: 0n,
    end: last,
    curve: { kind: 'tranches', tranches: list }
  };
};

/** What a schedule vests in all: its cliff plus its tranches, or the total given. */
export const entryTotal = (entry) => {
  if (entry.total !== undefined && entry.total !== null)
    return BigInt(entry.total);
  const { schedule } = entry;
  const tranches =
    schedule?.curve?.kind === 'tranches' ? schedule.curve.tranches : [];
  return tranches.reduce(
    (sum, tranche) => sum + BigInt(tranche.amount),
    BigInt(schedule?.cliffAmount ?? 0n)
  );
};

/** How many releases an entry has, which is what its gas grows with. */
const releasesOf = (entry) =>
  entry.schedule?.curve?.kind === 'tranches'
    ? entry.schedule.curve.tranches.length
    : 1;

const scheduleArg = (schedule) => ({
  start: schedule.start,
  cliff: schedule.cliff,
  cliff_amount: schedule.cliffAmount,
  end: schedule.end,
  curve:
    schedule.curve.kind === 'linear'
      ? { name: 'Linear', fields: {} }
      : schedule.curve.kind === 'stepped'
        ? { name: 'Stepped', fields: { interval: schedule.curve.interval } }
        : {
            name: 'Tranches',
            fields: {
              0: schedule.curve.tranches.map((tranche) => ({
                time: tranche.time,
                amount: tranche.amount
              }))
            }
          }
});

/** A schedule as sdk-core decodes it from mvxvest (views and arguments alike). */
export const scheduleFromNative = (native) => {
  const curve = native.curve;
  const name = curve?.name;
  let decoded;
  if (name === 'Linear') decoded = { kind: 'linear' };
  else if (name === 'Stepped') {
    const interval = curve.fields?.[0] ?? curve.fields?.interval;
    decoded = { kind: 'stepped', interval: toNum(interval) };
  } else if (name === 'Tranches') {
    decoded = {
      kind: 'tranches',
      tranches: (curve.fields?.[0] ?? []).map((tranche) => ({
        time: toNum(tranche.time),
        amount: toBig(tranche.amount)
      }))
    };
  } else throw new Error(`unknown curve ${String(name)}`);
  return {
    start: toNum(native.start),
    cliff: toNum(native.cliff),
    cliffAmount: toBig(native.cliff_amount),
    end: toNum(native.end),
    curve: decoded
  };
};

// --- the arguments, against the ABI ------------------------------------------

const serializer = new ArgSerializer();

/** createBatch(cancelable, label, entries...) as the bytes of each argument. */
export const encodeCreateBatchArgs = ({ cancelable, label, entries }) => {
  const native = [
    Boolean(cancelable),
    String(label ?? ''),
    ...entries.map((entry) => [
      Address.newFromBech32(entry.beneficiary),
      entryTotal(entry),
      scheduleArg(entry.schedule)
    ])
  ];
  const typed = NativeSerializer.nativeToTypedValues(
    native,
    mvxvestAbi.getEndpoint('createBatch')
  );
  return serializer
    .valuesToBuffers(typed)
    .map((buffer) => Uint8Array.from(buffer));
};

const entryOf = (address, total, schedule) => ({
  beneficiary: address.toBech32(),
  total: toBig(total),
  schedule: scheduleFromNative(schedule)
});

/** createBatch's arguments back as a batch, or { error } when they are not one. */
export const decodeCreateBatchArgs = (args) => {
  try {
    const values = serializer.buffersToValues(
      args.map((arg) => Buffer.from(arg)),
      mvxvestAbi.getEndpoint('createBatch').input
    );
    const [cancelable, label, entries] = values.map((value) => value.valueOf());
    return {
      cancelable: Boolean(cancelable),
      label: textOf(label),
      entries: entries.map(([address, total, schedule]) =>
        entryOf(address, total, schedule)
      )
    };
  } catch (error) {
    return {
      error: `These arguments could not be read as a createBatch: ${error?.message ?? error}`
    };
  }
};

/** create's arguments (one vesting) as a batch of one, or { error }. */
export const decodeCreateArgs = (args) => {
  try {
    const values = serializer.buffersToValues(
      args.map((arg) => Buffer.from(arg)),
      mvxvestAbi.getEndpoint('create').input
    );
    const [address, total, schedule, cancelable, label] = values.map((value) =>
      value.valueOf()
    );
    return {
      cancelable: Boolean(cancelable),
      label: textOf(label),
      entries: [entryOf(address, total, schedule)]
    };
  } catch (error) {
    return {
      error: `These arguments could not be read as a create: ${error?.message ?? error}`
    };
  }
};

// --- what the safe pays ------------------------------------------------------

/** One vesting's token fee, rounded down, as mvxvest takes it (create.rs). */
export const tokenFeeOf = (total, bps) => (BigInt(total) * BigInt(bps)) / BPS;

/**
 * The payment of a batch: the sum of the vestings plus the token fee of each,
 * in the token, and the EGLD fee of each, in EGLD. mvxvest wants it exactly.
 */
export const vestingPayment = (entries, { fee = 0n, tokenFeeBps = 0 } = {}) => {
  let sum = 0n;
  let tokenFee = 0n;
  for (const entry of entries) {
    const total = entryTotal(entry);
    sum += total;
    tokenFee += tokenFeeOf(total, tokenFeeBps);
  }
  const egldFee = BigInt(fee) * BigInt(entries.length);
  return { sum, tokenFee, egldFee, tokenAmount: sum + tokenFee };
};

// --- gas ---------------------------------------------------------------------

/**
 * What a vesting's list of t tranches costs mvxvest. It grows with the square
 * of t: mvxvest decodes, checks, stores and logs the list as one value (audit
 * VBD-03, 6 Nov 2026). On the pinned devnet mvxvest one cancelable vesting with
 * fees cost about 16.8M + 0.34M t + 0.0054M t² (24 tranches 28.1M, 120
 * tranches 135.3M). Rounded up by a third here.
 */
export const trancheGas = (tranches) => {
  const t = BigInt(tranches);
  return 450_000n * t + 7_200n * t * t;
};

/**
 * What the safe itself spends on a carry-out before the call leaves: it reads
 * the whole action back from its storage, about 6,300 gas a byte on devnet
 * (54.7M for a 7,827-byte batch, audit of 6 Nov 2026). The perform's flat 7.5M
 * covers a small action only; this is added to the need for the rest.
 */
export const actionReadGas = (actionBytes) => 6_500n * BigInt(actionBytes ?? 0);

/**
 * What createBatch needs, never less than devnet measured (6 Nov 2026,
 * scripts/devnet/vest-gas.mjs and the audit). On the pinned devnet mvxvest,
 * with hundreds of vestings, its keys' display set and fees on, a cancelable
 * vesting cost 9.9M, one that is not 6.8M, and its tranches what `trancheGas`
 * says; a fresh copy of the same code costs less. A real batch there (action
 * #33, two vestings of two tranches) used 25.1M. Each part is rounded up, and
 * the perform gets a fifth on top: the network cannot simulate the call as a
 * safe in another shard, and under its need the call runs out, the tokens come
 * back and the action is used up. Too much costs a thousandth of an EGLD.
 */
export const vestingGasNeed = ({
  entries,
  cancelable,
  feesPaid,
  actionBytes = 0
}) => {
  let need =
    7_000_000n + (feesPaid ? 3_000_000n : 0n) + actionReadGas(actionBytes);
  for (const entry of entries) {
    need += cancelable ? 12_000_000n : 8_500_000n;
    need += trancheGas(releasesOf(entry));
  }
  return need;
};

/**
 * What cancelling one vesting of t tranches needs: mvxvest loads the whole
 * vesting, schedule included, so it grows with t like a creation. Measured on
 * devnet: 6.2M for 1 tranche, 57.3M for 120 (audit VBD-04). Rounded up by
 * about a third.
 */
export const cancelGasNeed = (tranches) => {
  const t = BigInt(Math.max(1, Number(tranches) || 1));
  return 8_000_000n + 150_000n * t + 4_500n * t * t;
};

/** A cancel of one key of a one-tranche vesting, the least a cancel is given. */
export const CANCEL_GAS_NEED = cancelGasNeed(1);

// --- what is refused ---------------------------------------------------------

/** Why the pinned mvxvest must not be called now, or '': its address, code and keys. */
export const vestingContractProblem = (pin, facts) => {
  if (!pin)
    return 'There is no mvxvest on this network, so a safe cannot create or cancel vestings here.';
  if (!Address.newFromBech32(pin.address).isSmartContract())
    return `The pinned mvxvest address ${pin.address} is not a contract.`;
  const hash = String(facts?.codeHash ?? '').toLowerCase();
  if (!pin.codeHashes.includes(hash))
    return `The contract at ${pin.address} does not run code mvxsafe accepts: its code (${hash || 'unread'}) is not a release of mvxvest it knows. Nothing is proposed to it.`;
  // The collections it reports must be the ones pinned: the safe's keys are
  // looked for there, and the card names them.
  for (const [kind, read, pinned] of [
    ['claim', facts?.claimKeyCollection, pin.claimKey],
    ['cancel', facts?.cancelKeyCollection, pin.cancelKey]
  ]) {
    if (read && read !== pinned)
      return `mvxvest reports ${read} as its ${kind} keys, not ${pinned} as pinned. Nothing is proposed to it until that is understood.`;
  }
  return '';
};

/** A raw amount in a token's units, grouped: 1234567.5, or base units when the decimals are unknown. */
/** An NFT's identifier: its collection and its nonce in hex, as the API names it. */
export const keyIdentifier = (collection, nonce) => {
  let hex = BigInt(nonce).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return `${collection}-${hex}`;
};

export const formatRawAmount = (raw, decimals) => {
  const value = BigInt(raw);
  if (decimals === undefined || decimals === null)
    return `${value.toLocaleString('en-US')} base units of`;
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toLocaleString('en-US');
  const fraction = (value % scale)
    .toString()
    .padStart(Number(decimals), '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
};

const when = (seconds) =>
  `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** The parts after the token transfer: createBatch and its arguments. */
const createCall = (pin, safe, token, payment, args) => {
  const tail = [utf8('createBatch'), ...args];
  if (payment.egldFee > 0n) {
    // Two payments: a contract sends them by running MultiESDTNFTTransfer on
    // its own account, so the call goes to the safe itself (proven on devnet,
    // action #30 in docs/vestings-from-a-safe.md).
    return {
      to: safe,
      parts: [
        utf8('MultiESDTNFTTransfer'),
        Address.newFromBech32(pin.address).getPublicKey(),
        topEncode(2n),
        utf8(token),
        topEncode(0n),
        topEncode(payment.tokenAmount),
        utf8(EGLD_IN_TRANSFERS),
        topEncode(0n),
        topEncode(payment.egldFee),
        ...tail
      ]
    };
  }
  // One payment: the safe's own "Send tokens" call with createBatch after it.
  return {
    to: pin.address,
    parts: [
      utf8('ESDTTransfer'),
      utf8(token),
      topEncode(payment.tokenAmount),
      ...tail
    ]
  };
};

/**
 * The bytes the safe would store for these parts, each with its 4-byte
 * length: over MAX_ARGUMENT_BYTES the contract could not return the action,
 * and it would hide every other pending action (SC-01).
 */
const storedBytes = (parts) =>
  parts.reduce((sum, part) => sum + 4 + part.length, 0);

/** True when an address is a contract: mvxvest's keys reach it only if it is payable by contracts. */
const isContract = (address) => {
  try {
    return Address.newFromBech32(address).isSmartContract();
  } catch {
    return false;
  }
};

/**
 * Everything wrong with one vesting of a batch, each with its kind:
 *
 *   'refused'   mvxvest refuses it: carried out, the batch fails and the
 *               action is used up (create.rs, schedule.rs);
 *   'shape'     mvxvest takes it but mvxsafe never proposes it, because the
 *               card's list would not show what it does: a cliff release on
 *               top of the tranches, or another curve (audit VCD-02);
 *   'contract'  the beneficiary is a contract not known to receive tokens from
 *               contracts: its claim key fails or is stranded (VBD-02);
 *   'past'      a tranche date that has passed: refused in the form, amber on
 *               a card (mvxvest takes it and it vests at once).
 *
 * Shared by the form, the builder and the card, so a batch built by hand is
 * held to the rules the form keeps.
 */
export const entryIssues = (
  entry,
  at,
  { safe, pin, now, payableContracts = [], format = (raw) => `${raw}` }
) => {
  const issues = [];
  const row = `Vesting ${at + 1}`;
  let beneficiary;
  try {
    beneficiary = parseAddress(entry.beneficiary, 'beneficiary').toBech32();
  } catch (error) {
    return [{ kind: 'refused', text: `${row}: ${error.message}` }];
  }
  if (beneficiary === safe)
    issues.push({
      kind: 'shape',
      text: `${row}: the beneficiary is the safe itself. The safe would vest its own tokens to itself.`
    });
  else if (pin && beneficiary === pin.address)
    issues.push({
      kind: 'refused',
      text: `${row}: the beneficiary is mvxvest itself, which refuses it.`
    });
  else if (
    Address.newFromBech32(beneficiary)
      .getPublicKey()
      .every((byte) => byte === 0)
  )
    issues.push({
      kind: 'refused',
      text: `${row}: the beneficiary is the zero address, which mvxvest refuses.`
    });
  else if (isContract(beneficiary) && !payableContracts.includes(beneficiary))
    issues.push({
      kind: 'contract',
      text: `${row}: the beneficiary ${beneficiary} is a contract that is not known to accept tokens from contracts. mvxvest sends it a claim key it may refuse: the batch fails or the key is stranded where only mvxvest's owner can move it.`
    });

  const schedule = entry.schedule ?? {};
  for (const [name, value] of [
    ['start', schedule.start],
    ['cliff', schedule.cliff],
    ['end', schedule.end]
  ]) {
    if (!Number.isSafeInteger(value) || value < 0)
      return [
        ...issues,
        {
          kind: 'refused',
          text: `${row}: its ${name} is not a whole number of seconds.`
        }
      ];
  }
  const cliffAmount = BigInt(schedule.cliffAmount ?? 0n);
  const total = entryTotal(entry);
  const isTranches = schedule.curve?.kind === 'tranches';
  const tranches = isTranches ? schedule.curve.tranches : [];

  // A list of tranches first: start and end follow from it, so its own
  // mistakes are the ones to name.
  if (isTranches) {
    if (tranches.length === 0) {
      issues.push({
        kind: 'refused',
        text: `${row}: add at least one tranche.`
      });
      return issues;
    }
    if (tranches.length > VESTING_LIMITS.tranches)
      issues.push({
        kind: 'refused',
        text: `${row} has ${tranches.length} tranches; mvxvest takes at most ${VESTING_LIMITS.tranches} tranches a vesting.`
      });
    let previous = null;
    for (const tranche of tranches) {
      if (!Number.isSafeInteger(tranche.time) || tranche.time < 0) {
        issues.push({
          kind: 'refused',
          text: `${row}: a tranche time is not a whole number of seconds.`
        });
        return issues;
      }
      if (BigInt(tranche.amount) <= 0n) {
        issues.push({
          kind: 'refused',
          text: `${row}: every tranche has to be more than zero (${when(tranche.time)}).`
        });
        return issues;
      }
      if (previous !== null && tranche.time <= previous) {
        issues.push({
          kind: 'refused',
          text: `${row}: each tranche date has to be strictly later than the one before (${when(tranche.time)}).`
        });
        return issues;
      }
      previous = tranche.time;
    }
  }

  if (total <= 0n)
    issues.push({ kind: 'refused', text: `${row}: its total is zero.` });
  if (schedule.start > schedule.cliff || schedule.cliff > schedule.end)
    issues.push({
      kind: 'refused',
      text: `${row}: its start, cliff and end are out of order.`
    });
  if (cliffAmount > total)
    issues.push({
      kind: 'refused',
      text: `${row}: it releases more at its cliff than its total.`
    });
  if (cliffAmount > 0n)
    issues.push({
      kind: 'shape',
      text: `${row}: ${format(cliffAmount)} unlocks at its cliff, ${when(schedule.cliff)}, on top of what its list shows. mvxsafe never proposes this.`
    });
  if (schedule.end > now + VESTING_LIMITS.horizonSeconds)
    issues.push({
      kind: 'refused',
      text: `${row}: it ends ${when(schedule.end)}, more than 30 years ahead, which mvxvest refuses.`
    });

  if (!isTranches) {
    issues.push({
      kind: 'shape',
      text: `${row}: a ${schedule.curve?.kind ?? 'unknown'} schedule from ${when(schedule.start)} to ${when(schedule.end)}. mvxsafe proposes only a schedule of tranches.`
    });
    return issues;
  }
  const first = tranches[0].time;
  const last = tranches[tranches.length - 1].time;
  if (first < schedule.start)
    issues.push({
      kind: 'refused',
      text: `${row}: a tranche (${when(first)}) comes before its start.`
    });
  if (schedule.end !== last)
    issues.push({
      kind: 'refused',
      text: `${row}: its schedule does not end at its last tranche, which mvxvest refuses.`
    });
  const sum = tranches.reduce(
    (added, tranche) => added + BigInt(tranche.amount),
    0n
  );
  if (sum + cliffAmount !== total)
    issues.push({
      kind: 'refused',
      text: `${row}: its total does not add up to its tranches.`
    });
  if (schedule.start !== first || schedule.cliff !== schedule.start)
    issues.push({
      kind: 'shape',
      text: `${row}: its schedule does not start at its first tranche. mvxsafe never proposes this.`
    });
  const passed = tranches.filter((tranche) => tranche.time <= now);
  if (passed.length > 0)
    issues.push({
      kind: 'past',
      text: `${row}: ${passed.length === 1 ? `its tranche of ${when(passed[0].time)} is` : `${passed.length} of its tranches are`} in the past.`
    });
  return issues;
};

/**
 * Why this batch must not be proposed, or '' when it may. Checked by the form
 * and the builder alike, from what was typed and what was read on chain at
 * that moment (`facts`), so a batch that would fail after its signatures, or
 * reach anything but the pinned mvxvest, is never put to the board.
 */
export const vestingProblem = ({
  pin,
  facts,
  safe,
  token,
  cancelable,
  label,
  entries,
  decimals,
  now = Math.floor(Date.now() / 1000)
}) => {
  const pinned = vestingContractProblem(pin, facts);
  if (pinned) return pinned;
  if (facts.creationPaused)
    return 'mvxvest has paused the creation of vestings. Nothing can be created until its owner unpauses it.';
  if (!facts.claimKeyIssued)
    return 'mvxvest has not issued its claim keys yet, so it creates no vesting.';
  if (cancelable && !facts.cancelKeyIssued)
    return 'mvxvest has not issued its cancel keys yet, so it creates no cancelable vesting.';
  if (!facts.safePayableBySc)
    return 'This safe is not payable by smart contracts, so the cancel keys and refunds mvxvest sends back could not reach it. A safe made with mvxsafe always is.';

  const id = String(token ?? '').trim();
  if (id === 'EGLD' || id === EGLD_IN_TRANSFERS)
    return 'Vest a token, not EGLD: this action pays mvxvest in one token the safe holds.';
  if (!TOKEN_ID.test(id))
    return `"${id}" is not a token identifier, which looks like FOXSY-5d5f3e.`;
  if (utf8(String(label ?? '')).length > VESTING_LIMITS.labelBytes)
    return `The label is ${utf8(String(label)).length} bytes; mvxvest takes at most ${VESTING_LIMITS.labelBytes} bytes.`;

  const max = cancelable
    ? VESTING_LIMITS.batchCancelable
    : VESTING_LIMITS.batch;
  if (entries.length === 0) return 'Add at least one vesting.';
  if (entries.length > max)
    return `This batch has ${entries.length} vestings; mvxsafe proposes at most ${max} in one transaction${cancelable ? ' when they can be cancelled' : ''}. Split it into several proposals.`;

  for (const [at, entry] of entries.entries()) {
    const [first] = entryIssues(entry, at, {
      safe,
      pin,
      now,
      payableContracts: facts.payableContracts,
      format: (raw) => `${formatRawAmount(raw, decimals)} ${id}`
    });
    if (first)
      return first.kind === 'past'
        ? `${first.text} Every tranche date has to be in the future.`
        : first.text;
  }

  const payment = vestingPayment(entries, facts);
  if (
    typeof facts.safeBalance === 'bigint' &&
    payment.tokenAmount > facts.safeBalance
  )
    return `This batch needs ${formatRawAmount(payment.tokenAmount, decimals)} ${id}${payment.tokenFee > 0n ? `, mvxvest's token fee included` : ''}; the safe holds only ${formatRawAmount(facts.safeBalance, decimals)}.`;
  if (typeof facts.safeEgld === 'bigint' && payment.egldFee > facts.safeEgld)
    return `mvxvest's fee is ${formatRawAmount(payment.egldFee, 18)} EGLD for these ${entries.length} vestings, paid from the safe's own EGLD; the safe holds only ${formatRawAmount(facts.safeEgld, 18)}, not enough EGLD for the fee.`;

  const args = encodeCreateBatchArgs({ cancelable, label, entries });
  const { to, parts } = createCall(pin, safe, id, payment, args);
  const bytes = storedBytes(parts);
  if (bytes > MAX_ARGUMENT_BYTES)
    return `This batch is ${bytes.toLocaleString('en-US')} bytes, where the safe can only return a proposal of up to about ${MAX_ARGUMENT_BYTES.toLocaleString('en-US')}: a larger one could never be shown or carried out. It would hide every other pending action. Split it into smaller batches.`;
  const budget = performBudget(
    vestingGasNeed({
      entries,
      cancelable,
      feesPaid: payment.tokenFee > 0n || payment.egldFee > 0n,
      actionBytes: actionBytesOf(to, 0n, parts)
    })
  );
  if (budget > MAX_GAS)
    return `Carrying this batch out would need ${budget.toLocaleString('en-US')} gas, more than one transaction may use. Split it into smaller batches.`;
  return '';
};

/**
 * The bytes the safe stores for a call action: its receiver, its EGLD, then
 * the function and each argument with its 4-byte length. What it reads back
 * when the action is carried out.
 */
export const actionBytesOf = (to, egld, parts) =>
  32 + 4 + topEncode(BigInt(egld ?? 0n)).length + storedBytes(parts);

/** The bytes a batch would be stored as in the safe, for its carry-out's gas. */
export const batchActionBytes = ({
  pin,
  safe,
  token,
  cancelable,
  label,
  entries,
  facts
}) => {
  const payment = vestingPayment(entries, facts);
  const args = encodeCreateBatchArgs({ cancelable, label, entries });
  const { to, parts } = createCall(
    pin,
    safe,
    String(token).trim(),
    payment,
    args
  );
  return actionBytesOf(to, 0n, parts);
};

/** Why this cancel must not be proposed, or '' when it may. */
export const cancelProblem = ({ pin, facts, collection, nonce }) => {
  const pinned = vestingContractProblem(pin, facts);
  if (pinned) return pinned;
  if (collection !== pin.cancelKey)
    return `${collection} is not mvxvest's cancel key collection, ${pin.cancelKey}.`;
  if (!Number.isInteger(Number(nonce)) || Number(nonce) < 1)
    return 'A key number starts at 1.';
  // The cancel burns the key, then pays back with a plain transfer: a safe
  // that cannot receive it loses the refund (audit VFM-03).
  if (!facts.safePayableBySc)
    return 'This safe is not payable by smart contracts, so what the cancel pays back could not reach it. A safe made with mvxsafe always is.';
  return '';
};

// --- building ----------------------------------------------------------------

/** proposeAsyncCall(to, 0, parts...), the parts already encoded. */
const proposeAsync = async ({ chainId, sender, nonce, safe }, to, parts) => {
  const transaction = await new SmartContractTransactionsFactory({
    config: new TransactionsFactoryConfig({ chainID: chainId }),
    abi: legacyAbi
  }).createTransactionForExecute(new Address(sender), {
    contract: parseAddress(safe, 'safe address'),
    function: 'proposeAsyncCall',
    gasLimit: 0n,
    arguments: [
      new AddressValue(Address.newFromBech32(to)),
      new BigUIntValue(0n),
      VariadicValue.fromItems(
        ...parts.map((part) => new BytesValue(Buffer.from(part)))
      )
    ]
  });
  transaction.nonce = BigInt(nonce);
  return transaction;
};

/**
 * "Create vestings": the safe pays mvxvest and calls createBatch, so it is the
 * creator and receives every cancel key. Refused unless vestingProblem says
 * nothing.
 */
export const buildProposeVestings = async (context, input) => {
  const problem = vestingProblem({ ...input, safe: context.safe });
  if (problem) throw new Error(problem);
  const token = String(input.token).trim();
  const payment = vestingPayment(input.entries, input.facts);
  const args = encodeCreateBatchArgs(input);
  const { to, parts } = createCall(
    input.pin,
    context.safe,
    token,
    payment,
    args
  );
  return proposeAsync(context, to, parts);
};

/**
 * "Cancel a vesting": the safe sends one of its cancel keys to the pinned
 * mvxvest with cancel(). A contract sends an NFT by running ESDTNFTTransfer
 * on its own account, so the call goes to the safe itself (proven on devnet,
 * action #29 in docs/vestings-from-a-safe.md); the unvested tokens come back to the safe.
 */
export const buildProposeCancelVesting = async (
  context,
  { pin, facts, collection, nonce }
) => {
  const problem = cancelProblem({ pin, facts, collection, nonce });
  if (problem) throw new Error(problem);
  return proposeAsync(context, context.safe, [
    utf8('ESDTNFTTransfer'),
    utf8(collection),
    topEncode(BigInt(nonce)),
    topEncode(1n),
    Address.newFromBech32(pin.address).getPublicKey(),
    utf8('cancel')
  ]);
};

// --- reading a pending action back --------------------------------------------

const addressAt = (bytes) =>
  bytes?.length === 32 ? new Address(bytes).toBech32() : null;

const decodeFor = (fn, args) =>
  fn === 'create' ? decodeCreateArgs(args) : decodeCreateBatchArgs(args);

/**
 * What a pending call is, when it is a vesting: a creation (createBatch or
 * create, paid with a token transfer, or with EGLD) or a cancel (cancel keys
 * sent with cancel()). Read from the call alone, whatever the contract it
 * names, so a card can say when it is not the pinned mvxvest. Null for
 * anything else.
 */
export const readVestingCall = ({ to, egld = 0n, endpoint, args, safe }) => {
  const name = typeof endpoint === 'string' ? endpoint : textOf(endpoint);
  if (name === 'ESDTTransfer' && args.length >= 3) {
    const fn = textOf(args[2]);
    if (!CREATE_FUNCTIONS.has(fn)) return null;
    return {
      kind: 'create',
      fn,
      contract: to,
      payments: [{ token: textOf(args[0]), nonce: 0n, amount: bigOf(args[1]) }],
      batch: decodeFor(fn, args.slice(3))
    };
  }
  if (name === 'MultiESDTNFTTransfer' && to === safe && args.length >= 2) {
    const contract = addressAt(args[0]);
    const count = Number(bigOf(args[1]));
    if (
      !contract ||
      !Number.isInteger(count) ||
      count < 1 ||
      args.length < 3 + count * 3
    )
      return null;
    const payments = [];
    for (let at = 0; at < count; at++) {
      const [token, nonce, amount] = args.slice(2 + at * 3, 5 + at * 3);
      payments.push({
        token: textOf(token),
        nonce: bigOf(nonce),
        amount: bigOf(amount)
      });
    }
    const rest = args.slice(2 + count * 3);
    const fn = textOf(rest[0]);
    if (CREATE_FUNCTIONS.has(fn))
      return {
        kind: 'create',
        fn,
        contract,
        payments,
        batch: decodeFor(fn, rest.slice(1))
      };
    if (fn === 'cancel')
      return {
        kind: 'cancel',
        contract,
        keys: payments,
        ...(rest.length > 1 ? { unexpectedArguments: rest.length - 1 } : {})
      };
    return null;
  }
  if (name === 'ESDTNFTTransfer' && to === safe && args.length >= 5) {
    const contract = addressAt(args[3]);
    if (!contract || textOf(args[4]) !== 'cancel') return null;
    return {
      kind: 'cancel',
      contract,
      keys: [
        {
          token: textOf(args[0]),
          nonce: bigOf(args[1]),
          amount: bigOf(args[2])
        }
      ],
      ...(args.length > 5 ? { unexpectedArguments: args.length - 5 } : {})
    };
  }
  if (CREATE_FUNCTIONS.has(name) && BigInt(egld) > 0n) {
    return {
      kind: 'create',
      fn: name,
      contract: to,
      payments: [{ token: 'EGLD', nonce: 0n, amount: BigInt(egld) }],
      batch: decodeFor(name, args)
    };
  }
  return null;
};
