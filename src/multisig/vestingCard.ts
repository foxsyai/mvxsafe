// What a signer needs to see under a vesting action before signing it, read
// from mvxvest and the safe at that moment: that it goes to the pinned mvxvest
// running a release mvxsafe accepts, that it pays exactly what mvxvest wants
// now (a fee changed since the proposal makes it fail), that the safe holds
// what it pays and can receive the keys, every vesting it creates, and for a
// cancel what goes to the beneficiary and what comes back to the safe.

import { Address } from '@multiversx/sdk-core';
import { formatUnits, readTokenMeta, visible } from './describe';
import type { Check } from './inspect';
import { api, networkName } from './network';
import {
  cancelGasNeed,
  entryIssues,
  keyIdentifier,
  mvxvestFor,
  Payment,
  VESTING_LIMITS,
  VestingCall,
  vestingContractProblem,
  VestingEntry,
  vestingGasNeed,
  vestingPayment
} from './vesting';
import {
  cancelOutcome,
  readVestingFacts,
  readVestingOfCancelKey,
  VestingState
} from './vestingReads';

const EGLD_IN_TRANSFERS = 'EGLD-000000';

/** What the card lists under the sentence of a vesting action. */
export type VestingDetails =
  | {
      kind: 'create';
      contract: string;
      token: string;
      decimals: number | null;
      cancelable: boolean;
      label: string;
      entries: VestingEntry[];
      /** What the action pays, in the token and in EGLD. */
      paidToken: bigint;
      paidEgld: bigint;
    }
  | {
      kind: 'cancel';
      contract: string;
      keys: {
        identifier: string;
        vesting: VestingState | null;
        decimals: number | null;
      }[];
    };

export interface VestingInspection {
  checks: Check[];
  details?: VestingDetails;
  /** What carrying it out needs where mvxvest runs, before the fifth. */
  need: bigint;
}

const when = (seconds: number) =>
  `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const amountIn = (raw: bigint, token: string, decimals: number | null) =>
  decimals === null
    ? `${raw.toString()} base units of ${token}`
    : `${formatUnits(raw, decimals)} ${token}`;

const egldOf = (raw: bigint) => `${formatUnits(raw, 18)} EGLD`;

const bad = (text: string, advisory = false): Check => ({
  tone: 'bad',
  text,
  ...(advisory ? { advisory: true } : {})
});
const ok = (text: string): Check => ({ tone: 'ok', text });
const warn = (text: string): Check => ({ tone: 'warn', text });

/** What the call carries besides its data, from the stored action. */
export interface CallExtras {
  /** EGLD stored next to the call: never part of a vesting mvxsafe proposes. */
  egld?: bigint;
  /** The bytes the safe stores for the action, which it reads back at carry-out. */
  actionBytes?: number;
}

/** The payments as mvxvest adds them up: per token (create.rs received_payments). */
const sumsOf = (payments: Payment[]) => {
  const sums = new Map<string, bigint>();
  for (const payment of payments) {
    const key =
      payment.nonce > 0n
        ? keyIdentifier(payment.token, payment.nonce)
        : payment.token;
    sums.set(key, (sums.get(key) ?? 0n) + payment.amount);
  }
  return sums;
};

/**
 * Checks and details for a vesting action. A contract that is not the pinned
 * mvxvest is said in red and nothing more is read from it. Throws when
 * mvxvest or the safe cannot be read, which holds the card's Sign.
 */
export const inspectVesting = async (
  call: VestingCall,
  safe: string,
  now = Math.floor(Date.now() / 1000),
  { egld = 0n, actionBytes = 0 }: CallExtras = {}
): Promise<VestingInspection> => {
  const pin = mvxvestFor(networkName);
  const checks: Check[] = [];
  // A token transfer that carries EGLD is refused by the network
  // (ErrBuiltInFunctionCalledWithValue): carried out, it fails and the
  // action is used up, with EGLD the signers were never shown (VCD-01).
  const directEgld =
    call.kind === 'create' &&
    call.payments.some((paid) => paid.token === 'EGLD');
  if (egld > 0n && !directEgld)
    checks.push(
      bad(
        `It also sends ${formatUnits(egld, 18)} EGLD with the token transfer. The network refuses a token transfer that carries EGLD: carried out, it fails and the action is used up. mvxsafe never proposes it. Do not sign it.`
      )
    );
  if (!pin || call.contract !== pin.address) {
    const what =
      call.kind === 'cancel'
        ? 'cancel keys with cancel()'
        : `a payment with ${call.fn}`;
    checks.push(
      bad(
        `This sends ${what} to ${call.contract}, which looks like an mvxvest vesting, but ${pin ? `${call.contract} is not the mvxvest this site pins (${pin.address})` : 'this network has no mvxvest pinned'}. mvxsafe never proposes that. Do not sign it.`
      )
    );
    return { checks, need: 0n };
  }

  if (call.kind === 'cancel') return inspectCancel(call, safe, pin, checks);

  const batch = call.batch;
  if ('error' in batch) {
    checks.push(
      bad(
        `The vestings in this action could not be read: ${batch.error}. Do not sign it.`
      )
    );
    return { checks, need: 0n };
  }

  // What it pays, added up as mvxvest adds it up (VCD-05).
  const sums = sumsOf(call.payments);
  const tokens = [...sums.keys()].filter(
    (token) => token !== EGLD_IN_TRANSFERS
  );
  const token = tokens[0] ?? '';
  const paidToken = token ? (sums.get(token) ?? 0n) : 0n;
  const paidEgld = sums.get(EGLD_IN_TRANSFERS) ?? 0n;
  const fungible =
    tokens.length === 1 &&
    !token.match(/-[0-9a-f]{6}-[0-9a-f]+$/) &&
    token !== 'EGLD';
  const usual =
    fungible &&
    call.payments.filter((paid) => paid.token === token).length === 1 &&
    call.payments.filter((paid) => paid.token === EGLD_IN_TRANSFERS).length <=
      1;
  const beneficiaries = batch.entries.map((entry) => entry.beneficiary);
  const facts = await readVestingFacts(
    pin,
    safe,
    fungible ? token : undefined,
    beneficiaries
  );
  const { decimals } = fungible
    ? await readTokenMeta(token, false)
    : { decimals: null };

  const contract = vestingContractProblem(pin, facts);
  checks.push(
    contract
      ? bad(contract)
      : ok(
          `mvxvest at ${pin.address} runs a release mvxsafe accepts (code hash ${facts.codeHash!.slice(0, 8)}...), with its keys ${pin.claimKey} and ${pin.cancelKey}.`
        )
  );
  if (facts.creationPaused)
    checks.push(
      bad(
        'mvxvest has paused the creation of vestings. Carried out now, this fails: the tokens come back to the safe and the action is used up.',
        true
      )
    );

  if (!usual) {
    const list = call.payments
      .map((paid) =>
        amountIn(
          paid.amount,
          paid.nonce > 0n ? keyIdentifier(paid.token, paid.nonce) : paid.token,
          null
        )
      )
      .join(', ');
    checks.push(
      bad(
        `It pays in ${call.payments.length} transfer${call.payments.length === 1 ? '' : 's'} (${list}), a shape mvxsafe never proposes: one transfer of one token${expectedFeeShape(facts) ? ' and one of EGLD for the fee' : ''}. ${tokens.length > 1 || !fungible ? 'mvxvest takes one fungible token only: carried out, it fails and the action is used up. ' : ''}Check it in the explorer with every board member.`
      )
    );
  }

  // What is paid against what mvxvest wants now.
  const expected = vestingPayment(batch.entries, facts);
  if (fungible) {
    if (paidToken === expected.tokenAmount && paidEgld === expected.egldFee) {
      checks.push(
        expected.tokenFee === 0n && expected.egldFee === 0n
          ? ok(
              `mvxvest's fees read zero now: it pays exactly the vestings' ${amountIn(expected.sum, token, decimals)}.`
            )
          : ok(
              `It pays exactly what mvxvest wants now: ${amountIn(expected.sum, token, decimals)} for the vestings, ${amountIn(expected.tokenFee, token, decimals)} of token fee (${facts.tokenFeeBps / 100}% of each) and ${egldOf(expected.egldFee)} of fee (${egldOf(facts.fee)} a vesting). The fees go to mvxvest's owner.`
            )
      );
    } else {
      checks.push(
        bad(
          `mvxvest's fees are now ${egldOf(facts.fee)} a vesting and ${facts.tokenFeeBps / 100}% of each, so it wants exactly ${amountIn(expected.tokenAmount, token, decimals)} and ${egldOf(expected.egldFee)}. This action pays ${amountIn(paidToken, token, decimals)} and ${egldOf(paidEgld)}. Carried out now it fails: the tokens come back to the safe and the action is used up. Discard it and propose it again.`,
          true
        )
      );
    }
    if (typeof facts.safeBalance === 'bigint' && facts.safeBalance < paidToken)
      checks.push(
        bad(
          `The safe holds ${amountIn(facts.safeBalance, token, decimals)}, less than this pays. Carried out now, it fails.`,
          true
        )
      );
  }
  if (typeof facts.safeEgld === 'bigint' && facts.safeEgld < paidEgld)
    checks.push(
      bad(
        `The safe holds ${egldOf(facts.safeEgld)}, less than the ${egldOf(paidEgld)} of fees this pays. Carried out now, it fails.`,
        true
      )
    );
  if (!facts.safePayableBySc)
    checks.push(
      bad(
        'This safe is not payable by smart contracts: the cancel keys mvxvest sends back may never reach it. Do not sign it.'
      )
    );

  // The vestings themselves, held to the rules the form keeps (VCD-02, VCD-03).
  const max = batch.cancelable
    ? VESTING_LIMITS.batchCancelable
    : VESTING_LIMITS.contractBatch;
  if (batch.entries.length > max)
    checks.push(
      bad(
        `${batch.entries.length} vestings, where mvxvest takes at most ${max} in one transaction. Carried out, it fails and the action is used up.`
      )
    );
  const labelBytes = new TextEncoder().encode(batch.label).length;
  if (labelBytes > VESTING_LIMITS.labelBytes)
    checks.push(
      bad(
        `Its label is ${labelBytes} bytes, where mvxvest takes at most ${VESTING_LIMITS.labelBytes}. Carried out, it fails and the action is used up.`
      )
    );
  for (const [at, entry] of batch.entries.entries()) {
    const issues = entryIssues(entry, at, {
      safe,
      pin,
      now,
      payableContracts: facts.payableContracts,
      format: (raw) => amountIn(raw, token, decimals)
    });
    for (const issue of issues) {
      if (issue.kind === 'past')
        checks.push(
          warn(
            `${issue.text} What it releases vests the moment this is carried out.`
          )
        );
      else if (issue.kind === 'refused')
        checks.push(
          bad(
            `${issue.text} Carried out, the batch fails and the action is used up.`
          )
        );
      else if (issue.kind === 'shape')
        checks.push(bad(`${issue.text} Do not sign it.`));
      else checks.push(bad(issue.text));
    }
    // A contract that can receive the key may still never claim (VCD-06).
    if (
      entry.beneficiary !== safe &&
      entry.beneficiary !== pin.address &&
      (facts.payableContracts ?? []).includes(entry.beneficiary)
    ) {
      const line = `Vesting ${at + 1}: the beneficiary ${entry.beneficiary} is a contract. It can claim only if its own code can send the claim key back to mvxvest; a safe made with mvxsafe cannot.`;
      checks.push(
        batch.cancelable
          ? warn(line)
          : bad(`${line} Not cancelable, its tokens would stay locked.`)
      );
    }
  }
  checks.push(
    batch.cancelable
      ? ok(
          `Cancelable: mvxvest sends this safe one cancel key per vesting, ${batch.entries.length} in all. With a key the board can stop that vesting later and get back what has not vested.`
        )
      : warn(
          'Not cancelable: once carried out, nobody can stop these vestings or get their tokens back.'
        )
  );

  return {
    checks,
    details: {
      kind: 'create',
      contract: call.contract,
      token,
      decimals,
      cancelable: batch.cancelable,
      label: batch.label,
      entries: batch.entries,
      paidToken,
      paidEgld
    },
    need: vestingGasNeed({
      entries: batch.entries,
      cancelable: batch.cancelable,
      feesPaid:
        expected.tokenFee > 0n || expected.egldFee > 0n || paidEgld > 0n,
      actionBytes
    })
  };
};

/** Whether mvxvest's fees now call for an EGLD transfer beside the token. */
const expectedFeeShape = (facts: { fee: bigint }) => facts.fee > 0n;

const inspectCancel = async (
  call: Extract<VestingCall, { kind: 'cancel' }>,
  safe: string,
  pin: NonNullable<ReturnType<typeof mvxvestFor>>,
  checks: Check[]
): Promise<VestingInspection> => {
  const facts = await readVestingFacts(pin, safe);
  const contract = vestingContractProblem(pin, facts);
  checks.push(
    contract
      ? bad(contract)
      : ok(
          `mvxvest at ${pin.address} runs a release mvxsafe accepts (code hash ${facts.codeHash!.slice(0, 8)}...).`
        )
  );
  if (call.unexpectedArguments)
    checks.push(
      bad(
        `It passes ${call.unexpectedArguments} argument(s) to cancel, which takes none. Do not sign it.`
      )
    );
  if (!facts.safePayableBySc)
    checks.push(
      bad(
        'This safe is not payable by smart contracts: what the cancel pays back may never reach it. Do not sign it.'
      )
    );

  const keys: Extract<VestingDetails, { kind: 'cancel' }>['keys'] = [];
  let need = 0n;
  for (const key of call.keys as Payment[]) {
    const identifier = keyIdentifier(key.token, key.nonce);
    if (key.token !== pin.cancelKey || key.nonce < 1n) {
      checks.push(
        bad(
          `${visible(identifier)} is not one of mvxvest's cancel keys (${pin.cancelKey}). Do not sign it.`
        )
      );
      keys.push({ identifier, vesting: null, decimals: null });
      continue;
    }
    if (key.amount !== 1n)
      checks.push(
        bad(
          `It sends ${key.amount} of ${identifier}, where a key is one of a kind. Carried out, it fails.`
        )
      );
    const held = await api<{ balance?: string }>(
      `/accounts/${safe}/nfts/${identifier}`
    ).then(
      () => true,
      () => false
    );
    if (!held)
      checks.push(
        bad(
          `The safe does not hold ${identifier} now. Carried out, this fails and the action is used up.`,
          true
        )
      );
    const vesting = await readVestingOfCancelKey(pin, Number(key.nonce));
    const { decimals } = vesting
      ? await readTokenMeta(vesting.token, false)
      : { decimals: null };
    keys.push({ identifier, vesting, decimals });
    if (!vesting) {
      checks.push(
        bad(
          `mvxvest knows no vesting for ${identifier}. Carried out, this fails.`
        )
      );
      need += cancelGasNeed(1);
      continue;
    }
    // mvxvest loads the whole vesting to cancel it: its gas grows with its
    // tranches (audit VBD-04).
    need += cancelGasNeed(
      vesting.schedule.curve.kind === 'tranches'
        ? vesting.schedule.curve.tranches.length
        : 1
    );
    if (vesting.cancelledAt > 0) {
      checks.push(
        bad(
          `Vesting #${vesting.id} was already cancelled on ${when(vesting.cancelledAt)}. Carried out, this fails and the action is used up.`,
          true
        )
      );
      continue;
    }
    const outcome = cancelOutcome(vesting);
    checks.push(
      ok(
        `${identifier} cancels vesting #${vesting.id} of ${vesting.beneficiary}${vesting.label ? `, "${visible(vesting.label)}"` : ''}. Cancelled now: ${amountIn(outcome.toBeneficiary, vesting.token, decimals)} has vested and stays theirs to claim${outcome.alreadyClaimed > 0n ? ` (they have claimed ${amountIn(outcome.alreadyClaimed, vesting.token, decimals)} already)` : ''}. ${amountIn(outcome.toSafe, vesting.token, decimals)} not yet vested comes back to this safe. The later it is carried out, the more will have vested.`
      )
    );
  }
  return {
    checks,
    details: { kind: 'cancel', contract: call.contract, keys },
    need: need || cancelGasNeed(1)
  };
};

// Address is used to read a beneficiary as a contract in the details.
export const isContractAddress = (address: string) => {
  try {
    return Address.newFromBech32(address).isSmartContract();
  } catch {
    return false;
  }
};
