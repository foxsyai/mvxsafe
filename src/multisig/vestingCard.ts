// What a signer needs to see under a vesting action before signing it, read
// from mvxvest and the safe at that moment: that it goes to the pinned mvxvest
// running a release mvxsafe accepts, that it pays exactly what mvxvest wants
// now (a fee changed since the proposal makes it fail), that the safe holds
// what it pays and can receive the keys, every vesting it creates, and for a
// cancel what goes to the beneficiary and what comes back to the safe.

import { formatUnits, readTokenMeta, visible } from './describe';
import type { Check } from './inspect';
import { api, networkName } from './network';
import {
  CANCEL_GAS_NEED,
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

/**
 * Checks and details for a vesting action. A contract that is not the pinned
 * mvxvest is said in red and nothing more is read from it. Throws when
 * mvxvest or the safe cannot be read, which holds the card's Sign.
 */
export const inspectVesting = async (
  call: VestingCall,
  safe: string,
  now = Math.floor(Date.now() / 1000)
): Promise<VestingInspection> => {
  const pin = mvxvestFor(networkName);
  const fallbackNeed =
    call.kind === 'cancel'
      ? CANCEL_GAS_NEED * BigInt(Math.max(1, call.keys.length))
      : 0n;
  if (!pin || call.contract !== pin.address) {
    const what =
      call.kind === 'cancel'
        ? 'cancel keys with cancel()'
        : `a payment with ${call.fn}`;
    return {
      checks: [
        bad(
          `This sends ${what} to ${call.contract}, which looks like an mvxvest vesting, but ${pin ? `${call.contract} is not the mvxvest this site pins (${pin.address})` : 'this network has no mvxvest pinned'}. mvxsafe never proposes that. Do not sign it.`
        )
      ],
      need: fallbackNeed
    };
  }

  if (call.kind === 'cancel') return inspectCancel(call, safe, pin);

  const checks: Check[] = [];
  const batch = call.batch;
  if ('error' in batch) {
    return {
      checks: [
        bad(
          `The vestings in this action could not be read: ${batch.error}. Do not sign it.`
        )
      ],
      need: 0n
    };
  }
  const tokenPayment = call.payments.find(
    (payment) => payment.token !== EGLD_IN_TRANSFERS
  );
  const egldPayment = call.payments.find(
    (payment) => payment.token === EGLD_IN_TRANSFERS
  );
  const token = tokenPayment?.token ?? '';
  const facts = await readVestingFacts(
    pin,
    safe,
    token && token !== 'EGLD' ? token : undefined
  );
  const { decimals } =
    token && token !== 'EGLD'
      ? await readTokenMeta(token, false)
      : { decimals: 18 };

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

  // What is paid against what mvxvest wants now.
  const expected = vestingPayment(batch.entries, facts);
  const shape = call.payments.length === (expected.egldFee > 0n ? 2 : 1);
  const paidToken = tokenPayment?.amount ?? 0n;
  const paidEgld = egldPayment?.amount ?? 0n;
  if (token === 'EGLD' || !tokenPayment || tokenPayment.nonce !== 0n) {
    checks.push(
      bad(
        'It does not pay mvxvest in one fungible token, which is the only payment mvxsafe proposes. Do not sign it without checking it in the explorer.'
      )
    );
  } else if (
    shape &&
    paidToken === expected.tokenAmount &&
    paidEgld === expected.egldFee
  ) {
    checks.push(
      expected.tokenFee === 0n && expected.egldFee === 0n
        ? ok(
            `mvxvest's fees read zero now, and it pays exactly the vestings' ${amountIn(expected.sum, token, decimals)}.`
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

  // The vestings themselves.
  const max = batch.cancelable
    ? VESTING_LIMITS.batchCancelable
    : VESTING_LIMITS.batch;
  if (batch.entries.length > max)
    checks.push(
      bad(
        `${batch.entries.length} vestings, where mvxvest takes at most ${max} in one transaction. Carried out, it fails.`
      )
    );
  for (const [at, entry] of batch.entries.entries()) {
    const row = `Vesting ${at + 1} (${entry.beneficiary})`;
    if (entry.beneficiary === safe)
      checks.push(bad(`${row}: the beneficiary is this safe itself.`));
    if (entry.schedule.curve.kind !== 'tranches')
      checks.push(
        warn(
          `${row}: a ${entry.schedule.curve.kind} schedule, which mvxsafe does not propose. Read its start, cliff and end below with care.`
        )
      );
    if (entry.schedule.end > now + VESTING_LIMITS.horizonSeconds)
      checks.push(
        bad(
          `${row} ends ${when(entry.schedule.end)}, more than 30 years ahead. mvxvest refuses it.`
        )
      );
    const passed =
      entry.schedule.curve.kind === 'tranches'
        ? entry.schedule.curve.tranches.filter((tranche) => tranche.time <= now)
        : [];
    if (passed.length > 0)
      checks.push(
        warn(
          `${row}: ${passed.length === 1 ? `its tranche of ${when(passed[0].time)} has` : `${passed.length} of its tranches have`} passed. What they release vests the moment this is carried out.`
        )
      );
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
      feesPaid: expected.tokenFee > 0n || expected.egldFee > 0n
    })
  };
};

const inspectCancel = async (
  call: Extract<VestingCall, { kind: 'cancel' }>,
  safe: string,
  pin: NonNullable<ReturnType<typeof mvxvestFor>>
): Promise<VestingInspection> => {
  const checks: Check[] = [];
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
      continue;
    }
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
        `${identifier} cancels vesting #${vesting.id} of ${vesting.beneficiary}${vesting.label ? `, "${visible(vesting.label)}"` : ''}. Cancelled now: ${amountIn(outcome.toBeneficiary, vesting.token, decimals)} has vested and stays theirs to claim${outcome.alreadyClaimed > 0n ? ` (they have claimed ${amountIn(outcome.alreadyClaimed, vesting.token, decimals)} already)` : ''}, and ${amountIn(outcome.toSafe, vesting.token, decimals)} not yet vested comes back to this safe. The later it is carried out, the more will have vested.`
      )
    );
  }
  return {
    checks,
    details: { kind: 'cancel', contract: call.contract, keys },
    need: CANCEL_GAS_NEED * BigInt(Math.max(1, call.keys.length))
  };
};
