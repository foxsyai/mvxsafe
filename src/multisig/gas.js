// How much gas each transaction gets. Plain JavaScript for the same reason as
// legacyCalls.js: the devnet rehearsal imports this file, so the limits proven
// there are the limits the app sends.
//
// The rule: never more than about 1.5 times what is needed. A limit is paid
// for in full whenever it is not refunded, and every performAction on devnet
// shows gasUsed = gasLimit, so a flat 60M on a 5M signature was about ten times
// the fee for nothing. Two ways to know what is needed:
//
//   1. Ask the network to simulate the transaction, and add a fifth. Proposals,
//      signatures, discards, and performs that stay inside the safe go this way.
//   2. A budget, where the network cannot simulate: a perform that sends
//      anything out of the safe's shard answers "no async context found", or
//      "nil vm output" for a plain transfer. There the limit is the safe's own
//      part, the call's need plus a fifth, and the gas the network locks for the
//      safe's callback (handoff from mvxvest, 13 Oct 2026; an unpause performed
//      with 14M failed with "not enough gas" and used the action up,
//      ebc77b1cec8f4f3978f761881fbcc074ea8e9837b6d09514b2dad779155f4b16).
//
// Every figure below was measured on devnet, and a call and an upgrade were
// measured again on mainnet on 14 Oct 2026, the same to within 0.1M. Mainnet
// still spends gas differently in places (a token transfer to a wallet leaves
// with 0 gas and no callback there), so the performer always sees the budget
// and can change it. See docs/upgrade-and-calls.md.

import {
  Address,
  ErrEstimateTransactionCost,
  Transaction,
  TransactionComputer
} from '@multiversx/sdk-core';

/** What a guarded transaction costs on top: erd_extra_gas_limit_guarded_tx. */
export const GUARDIAN_GAS = 50000n;
/**
 * The multisig's own part of a perform: reading, clearing and dispatching the
 * action. Measured on devnet between 5.6M (an EGLD transfer) and 6.6M (a token
 * transfer).
 */
export const SAFE_OWN_GAS = 7500000n;
/**
 * Locked by the network for the safe's callback when a call leaves the safe:
 * 6,458,200, the gas every callback came back with from a wallet or from a
 * failed call on devnet (13 Oct 2026), not the 4M first assumed. A token
 * transfer performed with 7.5M + 0.4M + 5M ran out in the safe for it
 * (a0de137ec2ee1bfdfd4349a61d8194ec281660350aeb5b63b21c8a4f2b135f15, which
 * failed whole and left the action standing). Rounded up.
 */
export const CALLBACK_GAS = 7000000n;
/** erd_max_gas_per_transaction, the same on mainnet and devnet. */
export const MAX_GAS = 600000000n;

/**
 * What an upgrade from source needs where it runs: compiling the new code, at
 * 300 gas a byte, and its upgrade function. Measured on devnet, 13 Oct 2026:
 * mvxvest's 26,540 bytes used 8,264,045 in its own shard, twice, both with
 * 112.5M and with 16.7M forwarded. The code travels to that shard as an
 * argument but its size is NOT charged as data: the 88M first assumed for it
 * (3,000 a byte) worked and was five times what is needed. See
 * docs/devnet-rehearsal.md.
 */
export const UPGRADE_GAS_PER_BYTE = 300n;
export const UPGRADE_FIXED_GAS = 1000000n;

/**
 * What a plain EGLD transfer needs once it leaves the safe: the network's
 * minimum for a transaction, since a wallet runs nothing. Measured on devnet:
 * a transfer performed with 12.6M used about 5.6M in the safe and forwarded
 * the rest with the EGLD, where it was paid for and did nothing
 * (f0fcdb3b8f0f6bb7e4231d3e32c41d572da8096da2be6d514583a5c58de0e678).
 */
export const TRANSFER_NEED = 50000n;

/**
 * What a call is assumed to need when it could not be tried as the safe, for
 * example because the safe holds too little EGLD to pay for the trial. Twice
 * the most any of mvxvest's owner endpoints was measured at, and the performer
 * sees it and can change it.
 */
export const UNKNOWN_CALL_NEED = 10000000n;

const ceilDiv = (a, b) => (a + b - 1n) / b;
const roundUp = (gas, step = 100000n) => ceilDiv(gas, step) * step;

/** The simulated figure plus a fifth, rounded up. */
export const withMargin = (gas) => ceilDiv(BigInt(gas) * 6n, 5n);

/** What upgrading to a source of `codeBytes` bytes needs, before the margin. */
export const upgradeNeed = (codeBytes) =>
  UPGRADE_GAS_PER_BYTE * BigInt(codeBytes) + UPGRADE_FIXED_GAS;

/**
 * The limit of a perform whose call leaves the safe: its own 7.5M, the call's
 * need plus a fifth, and the callback's 5M, rounded up to 0.1M. A transfer
 * (SendTransferExecute) is not an async call and has no callback.
 */
export const performBudget = (need, callback = CALLBACK_GAS) =>
  roundUp(SAFE_OWN_GAS + withMargin(need) + callback);

/**
 * How a perform of this action gets its gas. The network cannot simulate a
 * perform that sends anything out of the safe's shard: an async call answers
 * "no async context found", even a plain EGLD transfer "nil vm output"
 * (devnet, 13 Oct 2026). So those get a budget:
 *
 * - an upgrade from source: from the size of the source's code;
 * - a call (SendAsyncCall, which is also how tokens leave): from what the call
 *   needed when it was tried as the safe, or UNKNOWN_CALL_NEED;
 * - a transfer (SendTransferExecute): the same without the callback, and for
 *   plain EGLD the network's minimum.
 *
 * Membership, quorum and deploys stay inside the safe and are simulated:
 * { simulate: true }. `known` says whether the need was measured; when it was
 * not, the page says so.
 */
export const performPlan = ({
  name,
  codeBytes,
  callNeed,
  hasFunction = true
}) => {
  let need;
  let known = true;
  let callback = CALLBACK_GAS;
  if (name === 'SCUpgradeFromSource') {
    if (!codeBytes) {
      need = upgradeNeed(26540);
      known = false;
    } else {
      need = upgradeNeed(codeBytes);
    }
  } else if (name === 'SendAsyncCall' || name === 'SendTransferExecute') {
    if (name === 'SendTransferExecute') callback = 0n;
    if (callNeed !== undefined && callNeed !== null) {
      need = BigInt(callNeed);
    } else if (name === 'SendTransferExecute' && !hasFunction) {
      need = TRANSFER_NEED;
    } else {
      need = UNKNOWN_CALL_NEED;
      known = false;
    }
  } else {
    return { simulate: true };
  }
  // Mainnet's first upgrades were given at least 118.5M until one had been
  // measured there. mvxvest's, on 14 Oct 2026, used exactly what devnet had
  // measured (8,501,645 for its 27,332 bytes, a callback of 3,392,472), so
  // mainnet gets the same budget as devnet now.
  return {
    simulate: false,
    known,
    need,
    gasLimit: performBudget(need, callback),
    parts: { safe: SAFE_OWN_GAS, call: withMargin(need), callback }
  };
};

/** A failed trial, saying which kind: the network said no, or never answered. */
export class GasError extends Error {
  constructor(message, refused) {
    super(message);
    this.refused = refused;
  }
}

const reasonOf = (error) =>
  String(error?.message ?? error ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * True when the network answered and refused, as opposed to not answering.
 * sdk-core throws ErrEstimateTransactionCost with the contract's own message
 * for the first kind; an HTTP 4xx is a refusal too, while no answer, a 429 or
 * a 5xx is the network being unavailable.
 */
const isRefusal = (error) => {
  if (error instanceof ErrEstimateTransactionCost) return true;
  const status = Number(error?.inner?.response?.status ?? 0);
  if (status)
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
  return /user error|execution failed|bypass guardian|insufficient balance|not enough gas/i.test(
    reasonOf(error)
  );
};

/**
 * The cost endpoint also checks the nonce of the person's own transaction
 * against the account. That nonce is the app's bookkeeping, not the action, and
 * the next read puts it right (tx audit TXN-05, 21 Oct 2026). Only there: in a
 * trial as the safe the target contract writes the answer, and could word a
 * refusal like this (review of PR #11).
 */
const isNonceComplaint = (error) =>
  /(lower|higher) nonce in transaction/i.test(reasonOf(error));

/**
 * Gives the transaction its gas limit, as the last step before signing.
 *
 * The guardian goes on FIRST: the network refuses even to simulate a guarded
 * account's transaction that does not name its guardian ("not allowed to
 * bypass guardian", mainnet, 13 Oct 2026). The guardian's 50,000 is added
 * after the simulation, and to budgets too.
 *
 * `budget` replaces the simulation for performs the network cannot simulate.
 */
export const settleGas = async (
  transaction,
  { provider, guardian = '', budget }
) => {
  if (guardian) {
    new TransactionComputer().applyGuardian(
      transaction,
      Address.newFromBech32(guardian)
    );
  }
  let gas;
  if (budget !== undefined && budget !== null) {
    gas = BigInt(budget);
  } else {
    transaction.gasLimit = 0n;
    let simulated;
    try {
      simulated = BigInt(
        (await provider.estimateTransactionCost(transaction)).gasLimit ?? 0
      );
    } catch (error) {
      throw isRefusal(error) && !isNonceComplaint(error)
        ? new GasError(
            `The network refused it when trying it in advance: ${reasonOf(error)}. Nothing was sent.`,
            true
          )
        : new GasError(
            `The network could not try it in advance (${reasonOf(error)}), so nothing was sent. Try again in a moment.`,
            false
          );
    }
    if (simulated <= 0n) {
      throw new GasError(
        'The network could not say what this needs, so nothing was sent.',
        false
      );
    }
    gas = withMargin(simulated);
  }
  if (guardian) gas += GUARDIAN_GAS;
  if (gas > MAX_GAS) {
    throw new GasError(
      `${gas.toLocaleString('en-US')} gas is more than one transaction may use (600,000,000).`,
      true
    );
  }
  transaction.gasLimit = gas;
  return transaction;
};

/**
 * What a call needs when the SAFE sends it, as the network simulates it. The
 * contract really runs it, owner checks included: setFee from a safe that is
 * not the owner answers "Endpoint can only be called by owner". The trial is
 * paid for by nobody but the network wants the sender to hold the fee, about
 * 0.0061 EGLD, or it answers "insufficient balance for fees".
 *
 * A token transfer to another shard is not run there by the simulation, and
 * the answer is then the maximum, 600,000,000, with no error (devnet, 13 Oct
 * 2026: 331,001 to a wallet in the safe's shard, 600,000,000 to one in
 * another). That is no measurement: it throws a GasError marked `unmeasured`.
 *
 * Returns the gas, or throws a GasError whose `refused` says whether it was
 * the network saying no.
 */
export const simulateAsSafe = async (
  provider,
  { chainId, safe, to, egld = 0n, data }
) => {
  const transaction = new Transaction({
    sender: Address.newFromBech32(safe),
    receiver: Address.newFromBech32(to),
    value: BigInt(egld),
    gasLimit: 0n,
    chainID: chainId,
    data: typeof data === 'string' ? new TextEncoder().encode(data) : data
  });
  let gas;
  try {
    gas = BigInt(
      (await provider.estimateTransactionCost(transaction)).gasLimit ?? 0
    );
  } catch (error) {
    if (error instanceof GasError) throw error;
    throw new GasError(reasonOf(error), isRefusal(error));
  }
  if (gas <= 0n || gas >= MAX_GAS) {
    const error = new GasError(
      'the network could not measure it: it runs in another shard',
      false
    );
    error.unmeasured = true;
    throw error;
  }
  return gas;
};

/** True when a trial as the safe failed only because the safe cannot pay for the trial. */
export const isTrialFeeShortfall = (error) =>
  /insufficient balance for fees/i.test(reasonOf(error));

/** builtInCost.ChangeOwnerAddress, the same on mainnet and devnet. */
export const CHANGE_OWNER_GAS = 5000000n;

/**
 * The limit of a safe's handover to itself, which is signed together with the
 * deploy and so cannot be simulated: the minimum, its data and the built-in's
 * fixed cost, plus a fifth. 6,209,400 for the usual 83 bytes, where a devnet
 * handover simulated at 5,174,501.
 */
export const handOverGas = (dataLength) =>
  withMargin(50000n + 1500n * BigInt(dataLength) + CHANGE_OWNER_GAS);

/** What a built-in token transfer costs: erd_min_gas_limit, its data, and builtInCost 200,000. */
export const TOKEN_TRANSFER_GAS = 200000n;

/**
 * The need of a plain token transfer (ESDTTransfer of one token, nothing
 * called after it), which the network does not need to simulate: the same
 * figures on mainnet and devnet. Null for anything else.
 */
export const tokenTransferNeed = (data) => {
  const parts = String(data).split('@');
  if (parts[0] !== 'ESDTTransfer' || parts.length !== 3) return null;
  return 50000n + 1500n * BigInt(String(data).length) + TOKEN_TRANSFER_GAS;
};

/**
 * What a call leaving the safe needs, and how that was found:
 *
 *   'tried'       the network simulated it as the safe;
 *   'token'       a plain token transfer, whose cost is fixed;
 *   'unmeasured'  the simulation could not run it in its shard;
 *   'fee'         the safe holds too little EGLD for the network to try it;
 *   'offline'     the network did not answer.
 *
 * `need` is null whenever it is not known. Throws the GasError when the
 * network tried the call and it FAILED, which is a reason not to go on.
 */
export const measureCall = async (provider, call) => {
  try {
    return { need: await simulateAsSafe(provider, call), how: 'tried' };
  } catch (error) {
    if (error?.unmeasured) {
      const fixed = tokenTransferNeed(call.data);
      return fixed
        ? { need: fixed, how: 'token' }
        : { need: null, how: 'unmeasured' };
    }
    if (isTrialFeeShortfall(error)) return { need: null, how: 'fee' };
    if (error instanceof GasError && error.refused) throw error;
    return { need: null, how: 'offline' };
  }
};

/**
 * The fee a limit costs, in base units of EGLD, at the minimum gas price: the
 * part that moves the data is paid in full, the rest at a hundredth
 * (erd_gas_price_modifier). A guarded transaction moves 50,000 more.
 */
export const feeOf = (gasLimit, dataLength, guarded = false) => {
  const price = 1000000000n;
  const movement =
    50000n + 1500n * BigInt(dataLength) + (guarded ? GUARDIAN_GAS : 0n);
  const limit = BigInt(gasLimit);
  if (limit <= movement) return limit * price;
  return movement * price + ((limit - movement) * price) / 100n;
};
