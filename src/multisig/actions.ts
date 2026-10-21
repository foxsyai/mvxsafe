// Sending something. Each function builds one transaction with the legacy
// builders in legacyCalls.js, hands it to the connected wallet to sign, and
// tracks it. Nothing here holds a key.

import { Address } from '@multiversx/sdk-core';
import {
  nonceToSign,
  sendSigned,
  signAndSendTransactions,
  signOnly,
  trackSent,
  windNonceBack
} from 'helpers/signAndSendTransactions';
import { getAccount } from 'lib';
import { handOverGas, settleGas } from './gas';
import {
  buildDeploySafe,
  buildDeploySource,
  buildDiscard,
  buildHandOver,
  buildPerform,
  buildProposeAddBoardMember,
  buildProposeAddProposer,
  buildProposeCall,
  buildProposeChangeQuorum,
  buildProposeEgld,
  buildProposeRemoveUser,
  buildProposeToken,
  buildProposeUpgrade,
  buildSign,
  buildUnsign,
  CodeMetadataFlags,
  MULTISIG_WASM_SHA256,
  predictSafeAddress,
  TypedArgument
} from './legacyCalls';
import { api, chainId, networkProvider } from './network';

export interface Signer {
  address: string;
  nonce: number;
}

/**
 * The nonce is read from the network at the moment of sending, not taken from
 * the account hook. A stale one is rejected by the node with "lowerNonceInTx",
 * and because the page used to swallow that, a signed transaction simply
 * vanished with no toast and nothing on chain (6 Oct 2026).
 */
const contextOf = async (signer: Signer, safe: string) => {
  let nonce = signer.nonce;
  try {
    const account = await networkProvider.getAccount(
      new Address(signer.address)
    );
    nonce = Number(account.nonce);
  } catch {
    // Fall back to what the page knows, rather than refusing to act at all.
  }
  return {
    chainId,
    sender: signer.address,
    nonce: nonceToSign(nonce),
    safe
  };
};

/**
 * The guardian of an account, if it has one switched on. A guarded account is
 * one where a second service has to co-sign everything, which is how a treasury
 * wallet should be held.
 */
const guardianOf = async (address: string): Promise<string> => {
  try {
    const account = await api<{
      isGuarded?: boolean;
      activeGuardianAddress?: string;
    }>(`/accounts/${address}?withGuardianInfo=true`);
    return account?.isGuarded ? (account.activeGuardianAddress ?? '') : '';
  } catch {
    // Unknown here, so the guardian the session read at login, if it is this
    // account's. Without one, the network will not even simulate a guarded
    // account's transaction, and the page said it refused a valid action
    // (tx audit TXN-03, 21 Oct 2026). With none known, it goes unguarded, and
    // a guarded account simply refuses it, which is safe: nothing moves.
    try {
      const session = getAccount();
      return session?.address === address && session.isGuarded
        ? (session.activeGuardianAddress ?? '')
        : '';
    } catch {
      return '';
    }
  }
};

/**
 * Each transaction gets its gas here, last, after its guardian: a simulation
 * plus a fifth, or the budget given for it where the network cannot simulate
 * (gas.js).
 */
const settleAll = async (
  transactions: any[],
  budgets: (bigint | undefined)[] = []
) => {
  // A guarded account can only send transactions that name their guardian and
  // carry its signature. Without these three fields the wallet has nothing it
  // can co-sign, and the attempt dies as if it had been cancelled, which is
  // exactly how it looked (6 Oct 2026). settleGas sets the guardian, version 2
  // and the guarded option BEFORE simulating, since the network will not even
  // simulate a guarded account's transaction without them; the wallet, or the
  // web wallet's two factor page, adds the second signature.
  const guardian = await guardianOf(transactions[0].sender.toBech32());
  for (const [at, transaction] of transactions.entries()) {
    await settleGas(transaction, {
      provider: networkProvider,
      guardian,
      budget: budgets[at]
    });
  }
};

const displayInfo = (label: string) => ({
  processingMessage: `${label}...`,
  errorMessage: `${label} failed`,
  successMessage: `${label} done`
});

/** Several transactions from one sender, signed together, sent in nonce order. */
const sendAll = async (
  transactions: any[],
  label: string,
  budgets: (bigint | undefined)[] = []
) => {
  await settleAll(transactions, budgets);
  return signAndSendTransactions({
    transactions,
    transactionsDisplayInfo: displayInfo(label)
  });
};

/**
 * Signs, and goes no further unless the first was signed at `nonce` and the
 * rest after it: a new contract's address follows from its deploy's nonce, and
 * the wallet may raise it (tx audit TXN-01, 21 Oct 2026).
 */
const signAt = async (transactions: any[], nonce: number) => {
  const signed = await signOnly(transactions);
  if (
    signed.some((transaction, at) => Number(transaction.nonce) !== nonce + at)
  ) {
    windNonceBack(signed);
    throw new Error(
      'The wallet signed this at another nonce than the one its address was worked out from, so nothing was sent. Try again in a few seconds.'
    );
  }
  return signed;
};

const send = (transaction: any, label: string, budget?: bigint) =>
  sendAll([transaction], label, [budget]);

export const signAction = async (
  signer: Signer,
  safe: string,
  actionId: number
) =>
  send(
    await buildSign(await contextOf(signer, safe), actionId),
    `Signing action ${actionId}`
  );

export const unsignAction = async (
  signer: Signer,
  safe: string,
  actionId: number
) =>
  send(
    await buildUnsign(await contextOf(signer, safe), actionId),
    `Removing your signature from action ${actionId}`
  );

/**
 * `budget` is the limit for an action the network cannot simulate (a call or
 * an upgrade that leaves the safe); without one the perform is simulated.
 */
export const performAction = async (
  signer: Signer,
  safe: string,
  actionId: number,
  budget?: bigint
) =>
  send(
    await buildPerform(await contextOf(signer, safe), actionId),
    `Carrying out action ${actionId}`,
    budget
  );

export const discardAction = async (
  signer: Signer,
  safe: string,
  actionId: number
) =>
  send(
    await buildDiscard(await contextOf(signer, safe), actionId),
    `Discarding action ${actionId}`
  );

export const proposeSendEgld = async (
  signer: Signer,
  safe: string,
  to: string,
  amount: string
) =>
  send(
    await buildProposeEgld(await contextOf(signer, safe), { to, amount }),
    'Proposing an EGLD transfer'
  );

export const proposeSendToken = async (
  signer: Signer,
  safe: string,
  to: string,
  tokenIdentifier: string,
  amount: string,
  decimals: number
) =>
  send(
    await buildProposeToken(await contextOf(signer, safe), {
      to,
      tokenIdentifier,
      amount,
      decimals
    }),
    'Proposing a token transfer'
  );

export const proposeAddBoardMember = async (
  signer: Signer,
  safe: string,
  member: string
) =>
  send(
    await buildProposeAddBoardMember(await contextOf(signer, safe), member),
    'Proposing a new board member'
  );

export const proposeAddProposer = async (
  signer: Signer,
  safe: string,
  proposer: string
) =>
  send(
    await buildProposeAddProposer(await contextOf(signer, safe), proposer),
    'Proposing a new proposer'
  );

export const proposeRemoveUser = async (
  signer: Signer,
  safe: string,
  user: string
) =>
  send(
    await buildProposeRemoveUser(await contextOf(signer, safe), user),
    'Proposing to remove a member'
  );

export const proposeChangeQuorum = async (
  signer: Signer,
  safe: string,
  newQuorum: number
) =>
  send(
    await buildProposeChangeQuorum(await contextOf(signer, safe), newQuorum),
    'Proposing a new quorum'
  );

export const proposeCall = async (
  signer: Signer,
  safe: string,
  call: {
    to: string;
    egld?: string;
    functionName: string;
    args?: TypedArgument[];
  }
) =>
  send(
    await buildProposeCall(await contextOf(signer, safe), call),
    `Proposing a call to ${call.functionName}`
  );

export const proposeUpgrade = async (
  signer: Signer,
  safe: string,
  upgrade: {
    target: string;
    source: string;
    metadata: CodeMetadataFlags;
    args?: TypedArgument[];
  }
) =>
  send(
    await buildProposeUpgrade(await contextOf(signer, safe), upgrade),
    'Proposing a contract upgrade'
  );

/**
 * Deploys the source of an upgrade from the connected wallet. Returns the new
 * contract's address, known before anything is sent, like a new safe's.
 */
export const deploySource = async (
  signer: Signer,
  bytecode: Uint8Array
): Promise<string> => {
  const { chainId: chain, sender, nonce } = await contextOf(signer, '');
  const address = predictSafeAddress(sender, nonce);
  const deploy = await buildDeploySource(
    { chainId: chain, sender, nonce },
    { bytecode }
  );
  await settleAll([deploy]);
  const signed = await signAt([deploy], nonce);
  await trackSent(
    signed,
    await sendSigned(signed),
    displayInfo('Deploying the source')
  );
  return address;
};

// --- creating a safe ---------------------------------------------------------

/**
 * The contract every new safe runs, fetched from this site and refused unless
 * it is byte for byte the one the app was tested against.
 */
const loadSafeCode = async (): Promise<Uint8Array> => {
  const response = await fetch('/contracts/multisig.wasm', {
    cache: 'no-store'
  });
  if (!response.ok) {
    throw new Error('The contract code could not be loaded. Nothing was sent.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  if (hex !== MULTISIG_WASM_SHA256) {
    throw new Error(
      'The contract code is not the one this app was tested with, so it was refused. Nothing was sent.'
    );
  }
  return bytes;
};

/**
 * The safe was created, but the transaction that makes it its own owner did
 * not reach the network: it is still in the deployer's hands, and its page
 * offers to hand it over.
 */
export class SafeNotHandedOver extends Error {
  constructor(
    public safe: string,
    failure: unknown
  ) {
    super(
      `The safe was created at ${safe}, but the transaction that makes it its own owner was not sent (${String((failure as Error)?.message ?? failure)}). Until it is, the safe is in your wallet's hands: open it and hand it to itself.`
    );
    this.name = 'SafeNotHandedOver';
  }
}

/**
 * Creates a safe and hands it to itself, as one pair of transactions to sign.
 * Returns the new safe's address, which is known before anything is sent: it
 * follows from the sender and the nonce of the deploy.
 */
export const createSafe = async (
  signer: Signer,
  { quorum, board }: { quorum: number; board: string[] }
): Promise<string> => {
  const bytecode = await loadSafeCode();
  const { chainId, sender, nonce } = await contextOf(signer, '');
  const safe = predictSafeAddress(sender, nonce);
  const deploy = await buildDeploySafe(
    { chainId, sender, nonce },
    { bytecode, quorum, board }
  );
  // The next nonce, so the network runs it right after the deploy, when the
  // contract exists and the sender still owns it.
  const handOver = await buildHandOver({
    chainId,
    sender,
    nonce: nonce + 1,
    safe
  });
  // The deploy is simulated. The handover cannot be, before the safe it hands
  // over exists, so it gets the fixed cost of ChangeOwnerAddress.
  await settleAll(
    [deploy, handOver],
    [undefined, handOverGas(handOver.data.length)]
  );
  const signed = await signAt([deploy, handOver], nonce);
  // One after the other, not together: sdk-dapp posts a batch as separate
  // requests and fails it whole if any one fails, although the others were
  // already accepted. A refused handover then looked like nothing was sent,
  // while the safe was created and left in the deployer's hands, at an address
  // the person was never shown (tx audit TXN-02, 21 Oct 2026).
  const deploySent = (await sendSigned([signed[0]])) as any[];
  let handOverSent: any[];
  try {
    handOverSent = (await sendSigned([signed[1]])) as any[];
  } catch (failure) {
    await trackSent([signed[0]], deploySent, displayInfo('Creating the safe'));
    throw new SafeNotHandedOver(safe, failure);
  }
  await trackSent(
    signed,
    [...deploySent, ...handOverSent],
    displayInfo('Creating the safe')
  );
  return safe;
};

/**
 * The second half on its own, for a safe whose handover never happened. By
 * now the safe exists, so the network can simulate it.
 */
export const handOverSafe = async (signer: Signer, safe: string) =>
  send(
    await buildHandOver(await contextOf(signer, safe)),
    'Handing the safe to itself'
  );
